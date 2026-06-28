// Background Service Worker for A1 Lead Scraper Pro

// Helper: Fetch with timeout
async function fetchWithTimeout(url, options = {}) {
  const { timeout = 6000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        ...options.headers
      }
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

// Check if a business lead exists in Supabase leads table
async function checkLeadInDatabase(mapsUrl) {
  if (!mapsUrl) return false;
  
  // Load credentials dynamically
  const creds = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);
  const supabaseUrl = creds.supabaseUrl;
  const supabaseKey = creds.supabaseKey;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('Database Sync Warning: Supabase credentials not configured in settings.');
    return false;
  }

  const queryUrl = `${supabaseUrl}/rest/v1/leads?maps_url=eq.${encodeURIComponent(mapsUrl)}`;
  try {
    const response = await fetchWithTimeout(queryUrl, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data && data.length > 0;
  } catch (error) {
    console.error('Error checking duplicate in database:', error);
    return false;
  }
}

// Insert a business lead into Supabase leads table
async function insertLeadInDatabase(lead) {
  // Load credentials dynamically
  const creds = await chrome.storage.local.get(['supabaseUrl', 'supabaseKey']);
  const supabaseUrl = creds.supabaseUrl;
  const supabaseKey = creds.supabaseKey;
  
  if (!supabaseUrl || !supabaseKey) {
    console.warn('Database Sync Warning: Supabase credentials not configured in settings.');
    return false;
  }

  const insertUrl = `${supabaseUrl}/rest/v1/leads`;
  const payload = {
    name: lead.name || 'N/A',
    rating: lead.rating || 'N/A',
    reviews_count: lead.reviewsCount || 'N/A',
    category: lead.category || 'N/A',
    address: lead.address || 'N/A',
    phone: lead.phone || 'N/A',
    website: lead.website || 'N/A',
    email: lead.email || 'N/A',
    maps_url: lead.mapsUrl || 'N/A'
  };
  
  try {
    const response = await fetchWithTimeout(insertUrl, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    return response.ok;
  } catch (error) {
    console.error('Error saving lead to database:', error);
    return false;
  }
}

// Helper: Email Validation & Filter
function validateEmail(email) {
  if (!email) return false;
  const emailLower = email.toLowerCase().trim();
  
  const emailCheck = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,8}$/;
  if (!emailCheck.test(emailLower)) return false;
  
  const invalidExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.js', '.css', '.woff', '.woff2', '.ttf', '.eot', '.mp3', '.mp4'];
  for (let ext of invalidExtensions) {
    if (emailLower.endsWith(ext)) return false;
  }
  
  const dummies = ['w3.org', 'sentry.io', 'example.com', 'email.com', 'yourdomain.com', 'domain.com', 'bootstrap', 'jquery', 'google', 'github'];
  for (let dummy of dummies) {
    if (emailLower.includes(dummy)) return false;
  }
  
  return true;
}

// Scrape HTML content for email addresses
function extractEmails(html) {
  const emails = new Set();
  if (!html) return [];
  
  // 1. Search for mailto links
  const mailtoMatch = html.match(/href=["']mailto:([^"'\s?#]+)/gi);
  if (mailtoMatch) {
    mailtoMatch.forEach(m => {
      const email = m.replace(/href=["']mailto:/i, '').trim();
      if (validateEmail(email)) {
        emails.add(email.toLowerCase());
      }
    });
  }
  
  // 2. Regex scan overall HTML body
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
  const textMatches = html.match(emailRegex);
  if (textMatches) {
    textMatches.forEach(email => {
      if (validateEmail(email)) {
        emails.add(email.toLowerCase());
      }
    });
  }
  
  return Array.from(emails);
}

// Listen for runtime messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'findEmails') {
    const { url } = message;
    
    if (!url || url === 'N/A') {
      sendResponse({ emails: [] });
      return true;
    }
    
    fetchWithTimeout(url)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
        return res.text();
      })
      .then(html => {
        const emails = extractEmails(html);
        sendResponse({ emails: emails });
      })
      .catch(err => {
        console.error(`Email Scraper failed for URL: ${url}`, err);
        sendResponse({ emails: [], error: err.message });
      });
      
    return true;
  }
  
  if (message.action === 'checkLeadExists') {
    checkLeadInDatabase(message.mapsUrl)
      .then(exists => {
        sendResponse({ exists: exists });
      })
      .catch(err => {
        sendResponse({ exists: false, error: err.message });
      });
    return true;
  }
  
  if (message.action === 'saveLeadToSupabase') {
    insertLeadInDatabase(message.lead)
      .then(success => {
        sendResponse({ success: success });
      })
      .catch(err => {
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }
});
