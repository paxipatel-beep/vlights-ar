import axios from 'axios';
import 'dotenv/config';

const SEARCH_PROVIDER = process.env.SEARCH_PROVIDER ?? 'mock';

function mockResults(query, count) {
  return Array.from({ length: count }, (_, i) => ({
    title: `Mock result ${i + 1} for: ${query}`,
    url: `https://example.com/${i + 1}`,
    snippet: `This is a mock search result for "${query}".`,
  }));
}

async function searchBrave(query, count) {
  const response = await axios.get(
    'https://api.search.brave.com/res/v1/web/search',
    {
      params: { q: query, count },
      headers: { 'X-Subscription-Token': process.env.BRAVE_API_KEY },
    }
  );
  return (response.data.web?.results ?? [])
    .slice(0, count)
    .map((r) => ({ title: r.title, url: r.url, snippet: r.description }));
}

async function searchSerper(query, count) {
  const response = await axios.post(
    'https://google.serper.dev/search',
    { q: query, num: count },
    { headers: { 'X-API-KEY': process.env.SERPER_API_KEY } }
  );
  return (response.data.organic ?? []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet,
  }));
}

export async function search(query, count = 5) {
  const provider = SEARCH_PROVIDER.toLowerCase();

  if (provider === 'mock') {
    return mockResults(query, count);
  }

  try {
    if (provider === 'brave') {
      return await searchBrave(query, count);
    }
    if (provider === 'serper') {
      return await searchSerper(query, count);
    }
    console.error(`Unknown SEARCH_PROVIDER "${provider}", falling back to mock`);
    return mockResults(query, count);
  } catch (error) {
    console.error(`Search provider "${provider}" failed:`, error.message);
    return mockResults(query, count);
  }
}
