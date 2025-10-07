// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// GroqCloud API configuration
const GROQ_API_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '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';
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'; // Default to Llama 3.3 70B Versatile

// Search API configuration
const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER || 'premium';
const BING_API_KEY = process.env.BING_API_KEY;
const BING_SEARCH_URL = process.env.BING_SEARCH_URL || 'https://api.bing.microsoft.com/v7.0/search';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID;
const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GUARDIAN_API_KEY = process.env.GUARDIAN_API_KEY;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    provider: 'GroqCloud',
    model: GROQ_MODEL
  });
});

// Research Assistant Helper Functions

// Refine search terms using Groq
async function refineSearchTerms(topic, apiKey = null) {
  const key = apiKey || GROQ_API_KEY;
  if (!key) {
    throw new Error('Groq API key is not configured');
  }

  const messages = [
    {
      role: 'system',
      content: 'You are an expert research assistant that creates comprehensive search strategies. Given a research topic, generate 6-8 diverse, specific search terms that will find different types of information: overviews, news, tutorials, academic papers, case studies, and recent developments. Include both broad and specific terms. Return only the search terms separated by commas, no explanations.'
    },
    {
      role: 'user',
      content: `Generate diverse search terms for comprehensive research on: "${topic}". Include terms for: overviews, news, tutorials, academic content, case studies, and recent developments.`
    }
  ];

  try {
    const response = await axios.post(`${GROQ_API_BASE_URL}/chat/completions`, {
      model: GROQ_MODEL,
      messages: messages,
      max_tokens: 200,
      temperature: 0.3,
      top_p: 0.9,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const searchTerms = response.data.choices[0].message.content
      .split(',')
      .map(term => term.trim())
      .filter(term => term.length > 0)
      .slice(0, 5); // Limit to 5 terms

    return searchTerms.length > 0 ? searchTerms : [topic]; // Fallback to original topic
  } catch (error) {
    console.error('Error refining search terms:', error.message);
    return [topic]; // Fallback to original topic
  }
}

// Perform web search using academic-level sources for comprehensive research
async function performWebSearch(searchTerms, maxResults = 25) {
  const allResults = [];
  const resultsPerTerm = Math.ceil(maxResults / (searchTerms.length * 3)); // 3 academic source types

  console.log(`Searching for ${searchTerms.length} terms using academic-level sources`);

  for (const term of searchTerms) {
    try {
      // Use academic and research sources in parallel for each term
      const searchPromises = [];
      
      // Academic and research sources (highest priority)
      searchPromises.push(
        searchAcademicPapers(term, resultsPerTerm).catch(err => {
          console.log(`Academic search failed for "${term}":`, err.message);
          return [];
        })
      );
      
      // Professional and industry sources
      searchPromises.push(
        searchProfessionalSources(term, resultsPerTerm).catch(err => {
          console.log(`Professional search failed for "${term}":`, err.message);
          return [];
        })
      );
      
      // Academic news and current events
      searchPromises.push(
        searchNewsSources(term, resultsPerTerm).catch(err => {
          console.log(`Academic news search failed for "${term}":`, err.message);
          return [];
        })
      );

      // Wait for all academic sources to complete
      const searchResults = await Promise.all(searchPromises);
      
      // Flatten and combine results
      const combinedResults = searchResults.flat();
      console.log(`Found ${combinedResults.length} total results for "${term}"`);
      allResults.push(...combinedResults);
      
    } catch (error) {
      console.error(`Error searching for "${term}":`, error.message);
    }
  }

  // Remove duplicates and prioritize academic sources
  const uniqueResults = deduplicateAndPrioritize(allResults, maxResults);

  console.log(`Total unique results from academic sources: ${uniqueResults.length}`);
  return uniqueResults;
}

// Search academic and quality news sources
async function searchNewsSources(query, maxResults = 8) {
  try {
    const results = [];
    
    // Search Nature News (academic science news)
    try {
      const natureResponse = await axios.get('https://www.nature.com/search', {
        params: {
          q: query,
          subject: 'news'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse Nature HTML results
      const html = natureResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="c-card__link"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('nature.com')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://www.nature.com${url}`,
            snippet: `Nature News: ${title}`,
            source: 'Nature News'
          });
        }
      }
    } catch (natureError) {
      console.log('Nature News search failed:', natureError.message);
    }

    // Search Science Daily (academic science news)
    try {
      const scienceDailyResponse = await axios.get('https://www.sciencedaily.com/search', {
        params: {
          q: query
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse Science Daily HTML results
      const html = scienceDailyResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="story-link"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('sciencedaily.com')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://www.sciencedaily.com${url}`,
            snippet: `Science Daily: ${title}`,
            source: 'Science Daily'
          });
        }
      }
    } catch (scienceDailyError) {
      console.log('Science Daily search failed:', scienceDailyError.message);
    }

    // Search MIT News (academic news)
    try {
      const mitResponse = await axios.get('https://news.mit.edu/search', {
        params: {
          q: query
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse MIT News HTML results
      const html = mitResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="news-article"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('mit.edu')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://news.mit.edu${url}`,
            snippet: `MIT News: ${title}`,
            source: 'MIT News'
          });
        }
      }
    } catch (mitError) {
      console.log('MIT News search failed:', mitError.message);
    }

    // Search Guardian API (quality journalism)
    try {
      const guardianResponse = await axios.get('https://content.guardianapis.com/search', {
        params: {
          q: query,
          'api-key': process.env.GUARDIAN_API_KEY || 'test',
          'show-fields': 'headline,trailText,thumbnail',
          'page-size': Math.ceil(maxResults / 2)
        },
        timeout: 10000
      });

      if (guardianResponse.data.response && guardianResponse.data.response.results) {
        guardianResponse.data.response.results.forEach(article => {
          if (results.length < maxResults) {
            results.push({
              title: article.webTitle,
              url: article.webUrl,
              snippet: article.fields?.trailText || article.webTitle,
              source: 'Guardian'
            });
          }
        });
      }
    } catch (guardianError) {
      console.log('Guardian search failed:', guardianError.message);
    }

    return results.slice(0, maxResults);
  } catch (error) {
    console.error('Academic news search error:', error.message);
    return [];
  }
}

// Search academic and research-oriented professional sources
async function searchProfessionalSources(query, maxResults = 8) {
  try {
    const results = [];
    
    // Search IEEE Xplore (academic engineering)
    try {
      const ieeeResponse = await axios.get('https://ieeexplore.ieee.org/search', {
        params: {
          queryText: query,
          sortType: 'relevance'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse IEEE Xplore results
      const html = ieeeResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="result-item"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('ieeexplore.ieee.org')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://ieeexplore.ieee.org${url}`,
            snippet: `IEEE Xplore: ${title}`,
            source: 'IEEE Xplore'
          });
        }
      }
    } catch (ieeeError) {
      console.log('IEEE Xplore search failed:', ieeeError.message);
    }

    // Search ACM Digital Library (computer science)
    try {
      const acmResponse = await axios.get('https://dl.acm.org/search', {
        params: {
          q: query,
          type: 'publication'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse ACM results
      const html = acmResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="search-result"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('dl.acm.org')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://dl.acm.org${url}`,
            snippet: `ACM Digital Library: ${title}`,
            source: 'ACM Digital Library'
          });
        }
      }
    } catch (acmError) {
      console.log('ACM Digital Library search failed:', acmError.message);
    }

    // Search SpringerLink (academic publishing)
    try {
      const springerResponse = await axios.get('https://link.springer.com/search', {
        params: {
          query: query,
          type: 'article'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse SpringerLink results
      const html = springerResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="title-link"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('link.springer.com')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://link.springer.com${url}`,
            snippet: `SpringerLink: ${title}`,
            source: 'SpringerLink'
          });
        }
      }
    } catch (springerError) {
      console.log('SpringerLink search failed:', springerError.message);
    }

    // Search GitHub (academic repositories)
    try {
      const githubResponse = await axios.get('https://github.com/search', {
        params: {
          q: query,
          type: 'repositories',
          sort: 'stars'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse GitHub results
      const html = githubResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="v-align-middle"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('github.com')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://github.com${url}`,
            snippet: `GitHub repository: ${title}`,
            source: 'GitHub'
          });
        }
      }
    } catch (githubError) {
      console.log('GitHub search failed:', githubError.message);
    }

    return results.slice(0, maxResults);
  } catch (error) {
    console.error('Academic professional search error:', error.message);
    return [];
  }
}

// Bing Search API
async function searchWithBing(query, maxResults = 5) {
  try {
    const response = await axios.get(BING_SEARCH_URL, {
      headers: {
        'Ocp-Apim-Subscription-Key': BING_API_KEY
      },
      params: {
        q: query,
        count: maxResults,
        mkt: 'en-US',
        safeSearch: 'Moderate'
      },
      timeout: 10000
    });

    return response.data.webPages?.value?.map(result => ({
      title: result.name,
      url: result.url,
      snippet: result.snippet,
      source: 'Bing'
    })) || [];
  } catch (error) {
    console.error('Bing search error:', error.message);
    return [];
  }
}

// Google Custom Search API
async function searchWithGoogle(query, maxResults = 5) {
  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: GOOGLE_API_KEY,
        cx: GOOGLE_SEARCH_ENGINE_ID,
        q: query,
        num: maxResults
      },
      timeout: 10000
    });

    return response.data.items?.map(result => ({
      title: result.title,
      url: result.link,
      snippet: result.snippet,
      source: 'Google'
    })) || [];
  } catch (error) {
    console.error('Google search error:', error.message);
    return [];
  }
}



// Search academic papers and research databases
async function searchAcademicPapers(query, maxResults = 10) {
  try {
    const results = [];
    
    // Search arXiv (free academic papers)
    try {
      const arxivResponse = await axios.get('http://export.arxiv.org/api/query', {
        params: {
          search_query: `all:${query}`,
          start: 0,
          max_results: Math.ceil(maxResults / 3),
          sortBy: 'relevance',
          sortOrder: 'descending'
        },
        timeout: 10000
      });

      // Parse arXiv XML response
      const xml = arxivResponse.data;
      const entryRegex = /<entry>[\s\S]*?<title>([^<]+)<\/title>[\s\S]*?<id>([^<]+)<\/id>[\s\S]*?<summary>([^<]+)<\/summary>[\s\S]*?<\/entry>/g;
      
      let match;
      while ((match = entryRegex.exec(xml)) !== null && results.length < maxResults) {
        const title = match[1];
        const url = match[2];
        const summary = match[3];
        
        results.push({
          title: title,
          url: url,
          snippet: summary.substring(0, 200) + '...',
          source: 'arXiv'
        });
      }
    } catch (arxivError) {
      console.log('arXiv search failed:', arxivError.message);
    }

    // Search PubMed (medical and scientific papers)
    try {
      const pubmedResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi', {
        params: {
          db: 'pubmed',
          term: query,
          retmax: Math.ceil(maxResults / 3),
          retmode: 'json',
          sort: 'relevance'
        },
        timeout: 10000
      });

      if (pubmedResponse.data.esearchresult && pubmedResponse.data.esearchresult.idlist) {
        const pmids = pubmedResponse.data.esearchresult.idlist.slice(0, 5);
        
        for (const pmid of pmids) {
          try {
            const summaryResponse = await axios.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi', {
              params: {
                db: 'pubmed',
                id: pmid,
                retmode: 'json'
              },
              timeout: 8000
            });

            if (summaryResponse.data.result && summaryResponse.data.result[pmid]) {
              const paper = summaryResponse.data.result[pmid];
              results.push({
                title: paper.title || 'PubMed Article',
                url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
                snippet: paper.abstract || paper.title || 'PubMed research paper',
                source: 'PubMed'
              });
            }
          } catch (summaryError) {
            // Continue with next PMID
          }
        }
      }
    } catch (pubmedError) {
      console.log('PubMed search failed:', pubmedError.message);
    }

    // Search Google Scholar (academic search)
    try {
      const scholarResponse = await axios.get('https://scholar.google.com/scholar', {
        params: {
          q: query,
          hl: 'en',
          as_sdt: '0,5'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse Google Scholar HTML results
      const html = scholarResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="gs_rt"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && !url.includes('scholar.google.com')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://scholar.google.com${url}`,
            snippet: `Google Scholar: ${title}`,
            source: 'Google Scholar'
          });
        }
      }
    } catch (scholarError) {
      console.log('Google Scholar search failed:', scholarError.message);
    }

    // Search ResearchGate (academic social network)
    try {
      const rgResponse = await axios.get('https://www.researchgate.net/search', {
        params: {
          q: query,
          type: 'publication'
        },
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        timeout: 10000
      });

      // Parse ResearchGate HTML results
      const html = rgResponse.data;
      const linkRegex = /<a[^>]+href="([^"]+)"[^>]*class="nova-e-link"[^>]*>([^<]+)<\/a>/g;
      
      let match;
      while ((match = linkRegex.exec(html)) !== null && results.length < maxResults) {
        const url = match[1];
        const title = match[2];
        if (url && title && url.includes('researchgate.net')) {
          results.push({
            title: title,
            url: url.startsWith('http') ? url : `https://www.researchgate.net${url}`,
            snippet: `ResearchGate: ${title}`,
            source: 'ResearchGate'
          });
        }
      }
    } catch (rgError) {
      console.log('ResearchGate search failed:', rgError.message);
    }

    return results.slice(0, maxResults);
  } catch (error) {
    console.error('Academic search error:', error.message);
    return [];
  }
}


// Deduplicate and prioritize results from multiple search engines
function deduplicateAndPrioritize(results, maxResults) {
  // Remove exact duplicates
  const uniqueResults = results.filter((result, index, self) => 
    index === self.findIndex(r => r.url === result.url)
  );

  // Prioritize diverse sources
  const prioritizedResults = [];
  const sourceCounts = {};
  const domainCounts = {};

  // First pass: prioritize by source diversity
  for (const result of uniqueResults) {
    try {
      const domain = new URL(result.url).hostname;
      const source = result.source;
      
      // Count occurrences
      sourceCounts[source] = (sourceCounts[source] || 0) + 1;
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
      
      // Prioritize results from underrepresented sources
      const sourceWeight = 1 / (sourceCounts[source] || 1);
      const domainWeight = 1 / (domainCounts[domain] || 1);
      const priority = sourceWeight + domainWeight;
      
      prioritizedResults.push({ ...result, priority });
    } catch (urlError) {
      // Skip invalid URLs
      console.log('Invalid URL:', result.url);
    }
  }

  // Sort by priority and take top results
  return prioritizedResults
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxResults)
    .map(({ priority, ...result }) => result); // Remove priority field
}

// Extract content from URLs
async function extractContentFromUrls(searchResults) {
  const extractedContents = [];
  const maxConcurrent = 5; // Process multiple URLs concurrently
  
  console.log(`Extracting content from ${searchResults.length} URLs`);
  
  // Process URLs in batches to avoid overwhelming the server
  for (let i = 0; i < searchResults.length; i += maxConcurrent) {
    const batch = searchResults.slice(i, i + maxConcurrent);
    const batchPromises = batch.map(async (result) => {
      try {
        // Use a simple HTTP request to get the page content
        const response = await axios.get(result.url, {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1'
          }
        });

        // Enhanced content extraction
        const html = response.data;
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : result.title;

        // Remove more elements for better content extraction
        const cleanHtml = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
          .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
          .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
          .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Extract meaningful content (first 3000 characters for more context)
        const content = cleanHtml.substring(0, 3000);
        const wordCount = content.split(/\s+/).length;

        if (content.length > 150) { // Only include if we got meaningful content
          return {
            title: title,
            url: result.url,
            snippet: result.snippet,
            content: content,
            wordCount: wordCount,
            source: result.source
          };
        } else {
          // Return with snippet as content if extraction was poor
          return {
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            content: result.snippet,
            wordCount: result.snippet.split(/\s+/).length,
            source: result.source
          };
        }
      } catch (error) {
        console.error(`Error extracting content from ${result.url}:`, error.message);
        // Return the search result even if content extraction failed
        return {
          title: result.title,
          url: result.url,
          snippet: result.snippet,
          content: result.snippet, // Use snippet as fallback content
          wordCount: result.snippet.split(/\s+/).length,
          source: result.source
        };
      }
    });

    try {
      const batchResults = await Promise.all(batchPromises);
      extractedContents.push(...batchResults);
      console.log(`Processed batch ${Math.floor(i/maxConcurrent) + 1}, extracted ${batchResults.length} contents`);
    } catch (batchError) {
      console.error('Batch processing error:', batchError.message);
    }
  }

  console.log(`Successfully extracted content from ${extractedContents.length} sources`);
  return extractedContents;
}

// Generate research summary using Groq
async function generateResearchSummary(topic, extractedContents, apiKey = null) {
  const key = apiKey || GROQ_API_KEY;
  if (!key) {
    throw new Error('Groq API key is not configured');
  }

  // Combine all content for analysis
  const combinedContent = extractedContents.map((content, index) => 
    `Source ${index + 1}: ${content.title}\nURL: ${content.url}\nContent: ${content.content}\n`
  ).join('\n\n');

  const messages = [
    {
      role: 'system',
      content: 'You are an expert research assistant with access to multiple sources. Analyze the provided research content from various sources and create a comprehensive, well-structured research summary. Synthesize information from all sources, identify patterns, contradictions, and key insights. Organize the information in a clear, professional format with sections and bullet points. Include source diversity analysis and highlight the most authoritative findings.'
    },
    {
      role: 'user',
      content: `Research Topic: "${topic}"\n\nAnalyze the following research content from ${extractedContents.length} sources and provide a comprehensive summary:\n\n${combinedContent}\n\nProvide a structured research summary with:\n1. Executive Summary\n2. Key Findings (synthesized from all sources)\n3. Main Insights and Patterns\n4. Source Analysis (diversity and reliability)\n5. Contradictions or Conflicting Information\n6. Recommendations and Next Steps\n7. Overall Assessment`
    }
  ];

  try {
    const response = await axios.post(`${GROQ_API_BASE_URL}/chat/completions`, {
      model: GROQ_MODEL,
      messages: messages,
      max_tokens: 1500,
      temperature: 0.7,
      top_p: 0.9,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });

    return response.data.choices[0].message.content;
  } catch (error) {
    console.error('Error generating research summary:', error.message);
    throw error;
  }
}

// Helper function to make Groq API calls with retry logic
async function callGroqAPI(messages, maxTokens = 500, temperature = 0.7, retries = 3, apiKey = null) {
  const key = apiKey || GROQ_API_KEY;
  if (!key) {
    throw new Error('Groq API key is not configured. Please set GROQ_API_KEY environment variable or provide API key in request.');
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Groq API attempt ${attempt}/${retries}`);
      
      const response = await axios.post(`${GROQ_API_BASE_URL}/chat/completions`, {
        model: GROQ_MODEL,
        messages: messages,
        max_tokens: maxTokens,
        temperature: temperature,
        top_p: 0.9,
        stream: false
      }, {
        headers: {
          'Authorization': `Bearer ${key}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000 // 30 second timeout
      });

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error(`Groq API attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}

// Analyze text using GroqCloud API
app.post('/analyze', async (req, res) => {
  try {
    const { text, type = 'summarize', apiKey } = req.body;
    
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text content is required' });
    }

    // Clean and validate text content
    const cleanedText = text.trim();
    if (cleanedText.length < 10) {
      return res.status(400).json({ error: 'Text content is too short. Please provide more substantial content to analyze.' });
    }

    // Check if content is mostly images or non-text (more strict)
    const textRatio = cleanedText.replace(/[^a-zA-Z0-9\s]/g, '').length / cleanedText.length;
    const wordCount = cleanedText.split(/\s+/).filter(word => word.length > 2).length;
    
    if (textRatio < 0.5 || wordCount < 10) {
      return res.status(400).json({ error: 'Content appears to be mostly images or non-text elements. Please analyze a text-based webpage with substantial written content.' });
    }

    // Truncate text if too long (Groq has token limits)
    const maxLength = 12000; // Increased for Groq's higher limits
    const truncatedText = cleanedText.length > maxLength ? cleanedText.substring(0, maxLength) + '...' : cleanedText;

    let systemPrompt, userPrompt;
    switch (type) {
      case 'summarize':
        systemPrompt = 'You are a helpful assistant that provides concise summaries of TEXT CONTENT ONLY. You can only analyze written text, not images, videos, or other media. Focus on the main points and key information from the text.';
        userPrompt = `Please provide a concise summary of the following TEXT CONTENT (ignore any references to images or media):\n\n${truncatedText}`;
        break;
      case 'analyze':
        systemPrompt = 'You are an expert content analyst that analyzes TEXT CONTENT ONLY. You can only analyze written text, not images, videos, or other media. Provide insights about the text content, tone, and main themes.';
        userPrompt = `Analyze the following TEXT CONTENT (ignore any references to images or media) and provide insights about its content, tone, and main themes:\n\n${truncatedText}`;
        break;
      case 'extract_keywords':
        systemPrompt = 'You are a keyword extraction specialist that works with TEXT CONTENT ONLY. Extract the most important keywords and topics from written text, ignoring any references to images or media.';
        userPrompt = `Extract the most important keywords and topics from this TEXT CONTENT (ignore any references to images or media):\n\n${truncatedText}`;
        break;
      default:
        systemPrompt = 'You are a helpful assistant that analyzes TEXT CONTENT ONLY. You can only analyze written text, not images, videos, or other media.';
        userPrompt = `Please analyze the following TEXT CONTENT (ignore any references to images or media):\n\n${truncatedText}`;
    }

    console.log(`Analyzing ${type} request for text length: ${text.length}`);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    const result = await callGroqAPI(messages, 500, 0.7, 3, apiKey);

    res.json({
      success: true,
      type: type,
      originalLength: text.length,
      summary: result,
      provider: 'GroqCloud',
      model: GROQ_MODEL,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error analyzing text:', error.message);
    
    let errorMessage = 'Failed to analyze text';
    if (error.response?.status === 401) {
      errorMessage = 'Invalid Groq API key. Please check your API key configuration.';
    } else if (error.response?.status === 429) {
      errorMessage = 'Rate limit exceeded. Please try again later.';
    } else if (error.response?.data?.error) {
      errorMessage = `Groq API error: ${error.response.data.error.message}`;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      provider: 'GroqCloud',
      timestamp: new Date().toISOString()
    });
  }
});

// Get available models from Groq
app.get('/models', async (req, res) => {
  try {
    res.json({
      success: true,
      models: [
        { name: 'llama-3.3-70b-versatile', id: 'llama-3.3-70b-versatile' },
        { name: 'llama-3.1-70b-versatile', id: 'llama-3.1-70b-versatile' },
        { name: 'llama-3.1-8b-instant', id: 'llama-3.1-8b-instant' },
        { name: 'mixtral-8x7b-32768', id: 'mixtral-8x7b-32768' }
      ],
      provider: 'GroqCloud',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching models:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available models',
      timestamp: new Date().toISOString()
    });
  }
});

// Chat endpoint for asking questions about analyzed content
app.post('/chat', async (req, res) => {
  try {
    const { question, pageContent, allTabContents, isMultiTab = false, chatHistory = [], apiKey } = req.body;
    
    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (isMultiTab && (!allTabContents || allTabContents.length === 0)) {
      return res.status(400).json({ error: 'Multi-tab content is required for cross-tab questions.' });
    }

    if (!isMultiTab && (!pageContent || pageContent.trim().length < 10)) {
      return res.status(400).json({ 
        success: false,
        error: 'Page content is required and must contain substantial text. Please analyze the current page first, or ask a multi-tab question using words like "compare" or "which is better".' 
      });
    }

    // Additional safety check for empty or invalid content
    if (!isMultiTab && pageContent && pageContent.trim().length < 50) {
      return res.status(400).json({ 
        success: false,
        error: 'The page content is too short to provide meaningful analysis. Please try analyzing a different webpage with more text content.' 
      });
    }

    // Build context from chat history
    let contextPrompt = '';
    if (chatHistory.length > 0) {
      contextPrompt = 'Previous conversation:\n';
      chatHistory.forEach(msg => {
        contextPrompt += `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}\n`;
      });
      contextPrompt += '\n';
    }

    let messages = [];
    let sources = [];

    if (isMultiTab) {
      // Stage 1: Create individual tab summaries first
      const tabSummaries = [];
      
      for (let i = 0; i < Math.min(allTabContents.length, 10); i++) {
        const tab = allTabContents[i];
        if (!tab.content || tab.content.trim().length < 50) {
          console.log(`Skipping tab ${tab.id} - insufficient content: ${tab.content?.length || 0} chars`);
          continue;
        }
        
        // Check if content is mostly text (not images) - more strict
        const textRatio = tab.content.replace(/[^a-zA-Z0-9\s]/g, '').length / tab.content.length;
        const wordCount = tab.content.split(/\s+/).filter(word => word.length > 2).length;
        
        if (textRatio < 0.5 || wordCount < 10) {
          console.log(`Skipping tab ${tab.id} - content appears to be mostly non-text (ratio: ${textRatio.toFixed(2)}, words: ${wordCount})`);
          continue;
        }
        
        try {
          const summaryMessages = [
            { 
              role: 'system', 
              content: 'You are a helpful assistant that creates concise summaries of TEXT CONTENT ONLY. You can only analyze written text, not images, videos, or other media. Provide exactly 3-5 bullet points with key facts and insights from the text.' 
            },
            { 
              role: 'user', 
              content: `Summarize this webpage TEXT CONTENT into exactly 3-5 concise bullet points. Focus on key facts, numbers, insights, and important information from the written text. Ignore any references to images, videos, or other media.

Title: ${tab.title || 'Untitled'}
URL: ${tab.url || 'Unknown'}

TEXT CONTENT:
${tab.content.substring(0, 2000)}...

Provide exactly 3-5 bullet points with key facts and insights from the text:`
            }
          ];

          const summary = await callGroqAPI(summaryMessages, 150, 0.5, 2, apiKey);

          tabSummaries.push({
            title: tab.title,
            url: tab.url,
            id: tab.id,
            summary: summary
          });
          
          sources.push({
            title: tab.title,
            url: tab.url,
            id: tab.id
          });
        } catch (error) {
          console.error(`Error summarizing tab ${tab.id}:`, error.message);
          // Continue with other tabs
        }
      }

      // Stage 2: Synthesize summaries to answer the question
      const combinedSummaries = tabSummaries.map((tab, index) => 
        `Tab ${index + 1} (${tab.title}): ${tab.summary}`
      ).join('\n\n');

      messages = [
        { 
          role: 'system', 
          content: 'You are an expert at analyzing TEXT CONTENT from multiple sources. You can only analyze written text, not images, videos, or other media. You must ONLY use information that is explicitly stated in the provided text content. Do NOT generate fictional responses, conversations, or information not present in the text. Synthesize information from text content, highlight conflicts, and provide actionable insights with clear source references.' 
        },
        { 
          role: 'user', 
          content: `${contextPrompt}You are analyzing summaries from multiple browser tabs to answer a cross-tab question. 
Based on the provided tab summaries, identify relevant information, detect any conflicts or contradictions, 
and provide a comprehensive answer with comparisons when appropriate.

Tab Summaries:
${combinedSummaries}

User's question: ${question}

Instructions:
1. Synthesize information from all relevant tab summaries
2. Highlight any conflicting information between tabs
3. Provide actionable insights in bullet points or comparison tables when appropriate
4. Clearly reference which tabs contain the information
5. If information is missing or contradictory, mention this clearly

Please provide a comprehensive answer based on all tab summaries:`
        }
      ];

    } else {
      // Single page analysis
      sources.push({
        title: 'Current Page',
        url: 'Current tab',
        id: 'current'
      });

      messages = [
        { 
          role: 'system', 
          content: 'You are a helpful assistant that answers questions based ONLY on the provided webpage TEXT CONTENT. You must ONLY use information that is explicitly stated in the provided text content. Do NOT generate fictional responses, conversations, or information not present in the text. If the text does not contain enough information to answer the question, say so clearly. Be accurate, concise, and cite specific information from the text content.' 
        },
        { 
          role: 'user', 
          content: `${contextPrompt}Based on the following webpage TEXT CONTENT, please answer the user's question. Be helpful, accurate, and concise. If the question cannot be answered from the text content, say so clearly.

Webpage TEXT CONTENT:
${pageContent.substring(0, 8000)}...

User's question: ${question}

Please provide a helpful answer based on the webpage text content:`
        }
      ];
    }

    console.log(`Chat request: "${question}" (${isMultiTab ? 'multi-tab' : 'single-page'}) for ${isMultiTab ? allTabContents.length : 1} content sources`);
    
    // Debug: Log content being sent to AI
    if (isMultiTab) {
      console.log(`Multi-tab content: ${allTabContents.length} tabs`);
      allTabContents.forEach((tab, index) => {
        console.log(`Tab ${index + 1}: ${tab.title} - ${tab.content?.length || 0} chars`);
      });
      
      // Validate that we have meaningful content
      const validTabs = allTabContents.filter(tab => tab.content && tab.content.trim().length > 50);
      if (validTabs.length === 0) {
        return res.status(400).json({ 
          success: false,
          error: 'No meaningful content found in the analyzed tabs. Please try analyzing different webpages with more text content.' 
        });
      }
    } else {
      console.log(`Single-page content: ${pageContent?.length || 0} chars`);
      console.log(`Content preview: ${pageContent?.substring(0, 200)}...`);
      
      // Validate content quality
      if (pageContent && pageContent.trim().length < 100) {
        return res.status(400).json({ 
          success: false,
          error: 'The page content is too short to provide meaningful analysis. Please try analyzing a different webpage with more text content.' 
        });
      }
    }

    const answer = await callGroqAPI(messages, isMultiTab ? 800 : 500, 0.7, 3, apiKey);

    // Check if the answer seems like a hallucination (contains fictional conversations)
    if (answer && (answer.includes('User 1:') || answer.includes('User 2:') || answer.includes('User 3:') || 
                   answer.includes('(smiling)') || answer.includes('(excitedly)') || 
                   answer.includes('entering the chat') || answer.includes('Hey guys'))) {
      console.log('Detected potential hallucination in AI response');
      return res.status(400).json({ 
        success: false,
        error: 'The AI generated an inappropriate response. Please try analyzing the page content first, or ask a more specific question about the actual content.' 
      });
    }

    const result = {
      success: true,
      question: question,
      answer: answer,
      sources: sources,
      isMultiTab: isMultiTab,
      provider: 'GroqCloud',
      model: GROQ_MODEL,
      timestamp: new Date().toISOString()
    };

    res.json(result);

  } catch (error) {
    console.error('Error processing chat:', error.message);
    
    let errorMessage = 'Failed to process your question';
    if (error.response?.status === 401) {
      errorMessage = 'Invalid Groq API key. Please check your API key configuration.';
    } else if (error.response?.status === 429) {
      errorMessage = 'Rate limit exceeded. Please try again later.';
    } else if (error.response?.data?.error) {
      errorMessage = `Groq API error: ${error.response.data.error.message}`;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      provider: 'GroqCloud',
      timestamp: new Date().toISOString()
    });
  }
});

// Research Assistant endpoint
app.post('/research', async (req, res) => {
  try {
    const { topic, maxResults = 15, apiKey } = req.body;
    
    if (!topic || typeof topic !== 'string') {
      return res.status(400).json({ error: 'Research topic is required' });
    }

    console.log(`Starting research for topic: "${topic}"`);

    // Step 1: Use Groq to refine search terms
    const refinedSearchTerms = await refineSearchTerms(topic, apiKey);
    console.log(`Refined search terms: ${refinedSearchTerms.join(', ')}`);

    // Step 2: Search for relevant results
    const searchResults = await performWebSearch(refinedSearchTerms, maxResults);
    console.log(`Found ${searchResults.length} search results`);

    if (searchResults.length === 0) {
      return res.status(400).json({ 
        success: false,
        error: 'No search results found for the given topic. Please try a different search term.' 
      });
    }

    // Step 3: Extract content from search results
    const extractedContents = await extractContentFromUrls(searchResults);
    console.log(`Extracted content from ${extractedContents.length} pages`);

    // Step 4: Generate research summary using Groq
    const researchSummary = await generateResearchSummary(topic, extractedContents, apiKey);

    res.json({
      success: true,
      topic: topic,
      searchTerms: refinedSearchTerms,
      totalResults: searchResults.length,
      extractedPages: extractedContents.length,
      summary: researchSummary,
      sources: extractedContents.map(content => ({
        title: content.title,
        url: content.url,
        snippet: content.snippet,
        wordCount: content.wordCount
      })),
      provider: 'GroqCloud',
      model: GROQ_MODEL,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in research:', error.message);
    
    let errorMessage = 'Failed to complete research';
    if (error.response?.status === 401) {
      errorMessage = 'Invalid Groq API key. Please check your API key configuration.';
    } else if (error.response?.status === 429) {
      errorMessage = 'Rate limit exceeded. Please try again later.';
    } else if (error.response?.data?.error) {
      errorMessage = `API error: ${error.response.data.error.message}`;
    }

    res.status(500).json({
      success: false,
      error: errorMessage,
      provider: 'GroqCloud',
      timestamp: new Date().toISOString()
    });
  }
});

// Tab analysis endpoint - analyzes content from all tabs
app.post('/analyze-tabs', async (req, res) => {
  try {
    const { tabs, tabContents, apiKey } = req.body;
    
    if (!tabs || !Array.isArray(tabs)) {
      return res.status(400).json({ error: 'Tabs array is required' });
    }

    if (!tabContents || !Array.isArray(tabContents)) {
      return res.status(400).json({ error: 'Tab contents are required for analysis' });
    }

    // Group tabs by domain
    const groupedTabs = tabs.reduce((acc, tab) => {
      try {
        const url = new URL(tab.url);
        const domain = url.hostname;
        if (!acc[domain]) {
          acc[domain] = [];
        }
        acc[domain].push(tab);
      } catch (e) {
        // Handle invalid URLs (chrome://, etc.)
        if (!acc['special']) {
          acc['special'] = [];
        }
        acc['special'].push(tab);
      }
      return acc;
    }, {});

    // Find potential duplicates
    const duplicates = [];
    Object.values(groupedTabs).forEach(tabGroup => {
      if (tabGroup.length > 1) {
        duplicates.push({
          domain: Object.keys(groupedTabs).find(key => groupedTabs[key] === tabGroup),
          count: tabGroup.length,
          tabs: tabGroup.map(tab => ({ id: tab.id, title: tab.title, url: tab.url }))
        });
      }
    });

    // Stage 1: Create concise summaries for each tab (3-5 bullet points)
    const tabSummaries = [];
    const maxTabsToAnalyze = 10; // Limit to prevent overwhelming the AI
    
    for (let i = 0; i < Math.min(tabContents.length, maxTabsToAnalyze); i++) {
      const tabContent = tabContents[i];
      if (!tabContent || !tabContent.content || tabContent.content.trim().length < 50) {
        console.log(`Skipping tab ${tabContent?.id || 'unknown'} - insufficient content: ${tabContent?.content?.length || 0} chars`);
        continue; // Skip tabs with insufficient content
      }
      
      // Check if content is mostly text (not images) - more strict
      const textRatio = tabContent.content.replace(/[^a-zA-Z0-9\s]/g, '').length / tabContent.content.length;
      const wordCount = tabContent.content.split(/\s+/).filter(word => word.length > 2).length;
      
      if (textRatio < 0.5 || wordCount < 10) {
        console.log(`Skipping tab ${tabContent.id} - content appears to be mostly non-text (ratio: ${textRatio.toFixed(2)}, words: ${wordCount})`);
        continue;
      }

      try {
        // Truncate content if too long
        const maxLength = 3000; // Increased for Groq's higher limits
        const truncatedContent = tabContent.content.length > maxLength 
          ? tabContent.content.substring(0, maxLength) + '...' 
          : tabContent.content;

        const messages = [
          { 
            role: 'system', 
            content: 'You are a helpful assistant that creates concise summaries of TEXT CONTENT ONLY. You can only analyze written text, not images, videos, or other media. Provide exactly 3-5 bullet points with key facts and insights from the text.' 
          },
          { 
            role: 'user', 
            content: `Summarize this webpage TEXT CONTENT into exactly 3-5 concise bullet points. Focus on key facts, numbers, insights, and important information from the written text. Ignore any references to images, videos, or other media.

Title: ${tabContent.title || 'Untitled'}
URL: ${tabContent.url || 'Unknown'}

TEXT CONTENT:
${truncatedContent}

Provide exactly 3-5 bullet points with key facts and insights from the text:`
          }
        ];

        const summary = await callGroqAPI(messages, 150, 0.5, 2, apiKey);

        tabSummaries.push({
          id: tabContent.id,
          title: tabContent.title,
          url: tabContent.url,
          summary: summary,
          wordCount: tabContent.content.split(/\s+/).length
        });

      } catch (error) {
        console.error(`Error summarizing tab ${tabContent.id}:`, error.message);
        // Continue with other tabs even if one fails
        tabSummaries.push({
          id: tabContent.id,
          title: tabContent.title,
          url: tabContent.url,
          summary: `Summary failed: ${error.message.includes('timeout') ? 'Request timed out' : 'Processing error'}`,
          wordCount: 0,
          error: true
        });
      }
    }

    // Stage 2: Create overall summary from individual tab summaries
    let overallSummary = '';
    if (tabSummaries.length > 0) {
      try {
        const summaryMessages = [
          { 
            role: 'system', 
            content: 'You are an expert at analyzing browsing patterns. Provide a concise overview of main topics and themes across multiple web pages.' 
          },
          { 
            role: 'user', 
            content: `Based on the summaries of ${tabSummaries.length} web pages, provide a brief overview of the main topics and themes across all tabs. Focus on common patterns and key insights:

${tabSummaries.map((summary, index) => 
  `${index + 1}. ${summary.title}: ${summary.summary}`
).join('\n\n')}

Please provide a concise summary of the overall browsing session:`
          }
        ];

        overallSummary = await callGroqAPI(summaryMessages, 300, 0.7, 2, apiKey);
      } catch (error) {
        console.error('Error creating overall summary:', error.message);
        overallSummary = 'Unable to generate overall summary due to processing error.';
      }
    }

    res.json({
      success: true,
      totalTabs: tabs.length,
      analyzedTabs: tabSummaries.length,
      tabSummaries: tabSummaries,
      overallSummary: overallSummary,
      groupedTabs: groupedTabs,
      duplicates: duplicates,
      suggestions: {
        closeDuplicates: duplicates.length > 0,
        groupByDomain: Object.keys(groupedTabs).length > 1
      },
      provider: 'GroqCloud',
      model: GROQ_MODEL,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error analyzing tabs:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze tabs',
      provider: 'GroqCloud',
      timestamp: new Date().toISOString()
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 AI Browser Copilot server running on http://localhost:${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🤖 Using GroqCloud API with model: ${GROQ_MODEL}`);
  if (!GROQ_API_KEY) {
    console.log(`⚠️  WARNING: GROQ_API_KEY not set. Please configure your Groq API key.`);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down AI Browser Copilot server...');
  process.exit(0);
});