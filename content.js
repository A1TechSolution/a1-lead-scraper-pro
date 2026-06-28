// Content Script for A1 Lead Scraper Pro

let isRunning = false;
let scrapedLeads = [];
let scrapedUrls = new Set();
let limit = 100;
let mode = 'deep';
let emailScrape = true;
let dbSync = true;

// Helper: Delay execution
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: Get data from local storage
function getStorageData(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => {
      resolve(result);
    });
  });
}

// Helper: Write log messages to popup storage
function logToPopup(text, type = 'info') {
  const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const formattedText = `[${timestamp}] ${text}`;
  
  chrome.storage.local.get(['logs'], (data) => {
    const logs = data.logs || [];
    logs.push(formattedText);
    if (logs.length > 150) logs.shift();
    chrome.storage.local.set({ logs: logs });
  });
}

// Helper: Save current scraped leads and scraper status
async function saveState() {
  await chrome.storage.local.set({
    leads: scrapedLeads,
    isScraping: isRunning
  });
}

// Helper: Request background.js to fetch website and scrape emails
function requestEmailsFromBackground(url) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'findEmails', url: url }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve([]);
      } else {
        resolve(response.emails || []);
      }
    });
  });
}

// Helper: Request background.js to check if lead exists in database
function checkDuplicateInDatabase(mapsUrl) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'checkLeadExists', mapsUrl: mapsUrl }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve(false);
      } else {
        resolve(!!response.exists);
      }
    });
  });
}

// Helper: Request background.js to save lead in database
function saveLeadToDatabase(lead) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action: 'saveLeadToSupabase', lead: lead }, (response) => {
      if (chrome.runtime.lastError || !response) {
        resolve(false);
      } else {
        resolve(!!response.success);
      }
    });
  });
}

// Helper: Email validation for page text matches
function validateEmail(email) {
  if (!email) return false;
  const emailLower = email.toLowerCase().trim();
  const emailCheck = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,8}$/;
  if (!emailCheck.test(emailLower)) return false;
  
  const invalidExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.js', '.css', '.woff', '.woff2', '.ttf'];
  for (let ext of invalidExtensions) {
    if (emailLower.endsWith(ext)) return false;
  }
  return true;
}

// Listen for control messages from popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    limit = message.limit || 100;
    mode = message.mode || 'deep';
    emailScrape = message.emailScrape !== undefined ? message.emailScrape : true;
    dbSync = message.dbSync !== undefined ? message.dbSync : true;
    
    if (!isRunning) {
      isRunning = true;
      startScraping();
    }
    sendResponse({ success: true });
  } else if (message.action === 'stop') {
    isRunning = false;
    sendResponse({ success: true });
  }
  return true;
});

// Locate the results list scroll container
function getScrollContainer() {
  const feed = document.querySelector('div[role="feed"]');
  if (feed) return feed;
  
  const placeLink = document.querySelector('a[href*="/maps/place/"]');
  if (placeLink) {
    let parent = placeLink.parentElement;
    while (parent && parent !== document.body) {
      const overflow = window.getComputedStyle(parent).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') {
        return parent;
      }
      parent = parent.parentElement;
    }
  }
  return document.querySelector('.m6ZQ1c') || document.querySelector('.ecr1E');
}

// Parse details visible in the search listing card itself
function parseListing(link) {
  const name = link.getAttribute('aria-label') || '';
  const mapsUrl = link.href || '';
  
  const card = link.closest('.Nv2yGc') || link.closest('.UaQR3c') || link.parentElement;
  if (!card) return { name, mapsUrl, rating: 'N/A', reviewsCount: 'N/A', category: 'N/A' };
  
  let rating = 'N/A';
  let reviewsCount = 'N/A';
  let category = 'N/A';
  
  const ratingEl = card.querySelector('.MW4etd') || card.querySelector('span[aria-hidden="true"]');
  if (ratingEl && /^[3-5]\.\d$/.test(ratingEl.textContent.trim())) {
    rating = ratingEl.textContent.trim();
  }
  
  const reviewsEl = card.querySelector('.UY7F9') || card.querySelector('span[aria-label*="reviews"]');
  if (reviewsEl) {
    const revText = reviewsEl.textContent.replace(/[()]/g, '').trim();
    if (revText) reviewsCount = revText;
  }
  
  if (rating === 'N/A' || reviewsCount === 'N/A') {
    const text = card.textContent || '';
    const match = text.match(/([3-5]\.\d)\s*\(([\d,]+)\)/);
    if (match) {
      if (rating === 'N/A') rating = match[1];
      if (reviewsCount === 'N/A') reviewsCount = match[2];
    }
  }
  
  const spans = card.querySelectorAll('span');
  for (let span of spans) {
    const t = span.textContent.trim();
    if (t.startsWith('·') && t.length > 2 && !t.includes('$') && !t.includes('Open') && !t.includes('Closed')) {
      category = t.replace('·', '').trim();
      break;
    }
  }
  
  if (category === 'N/A') {
    const text = card.textContent || '';
    const parts = text.split('·');
    if (parts.length > 1) {
      for (let part of parts) {
        const cleanPart = part.trim();
        if (
          cleanPart && 
          cleanPart.length > 2 && 
          cleanPart.length < 30 && 
          !cleanPart.includes('$') && 
          !cleanPart.includes('Open') && 
          !cleanPart.includes('Closed') &&
          !/^\d/.test(cleanPart)
        ) {
          category = cleanPart;
          break;
        }
      }
    }
  }
  
  return { name, rating, reviewsCount, category, mapsUrl };
}

// Wait for detail panel to render matching place title
async function waitForDetailsPanel(placeName, maxWaitMs = 6000) {
  const startTime = Date.now();
  const normalizedTarget = placeName.trim().toLowerCase();
  
  while (Date.now() - startTime < maxWaitMs) {
    if (!isRunning) return false;
    
    const titleEl = document.querySelector('h1.DUwDvf') || document.querySelector('h1.lfPI7d') || document.querySelector('h1');
    if (titleEl) {
      const titleText = titleEl.textContent.trim().toLowerCase();
      if (titleText.includes(normalizedTarget) || normalizedTarget.includes(titleText)) {
        await delay(600);
        return true;
      }
    }
    await delay(250);
  }
  return false;
}

// Check if email is explicitly listed in the maps detail panel text
function checkEmailInMapsPanel() {
  const panel = document.querySelector('div[role="main"]') || document.body;
  const text = panel.textContent || '';
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
  const matches = text.match(emailRegex);
  
  if (matches) {
    const unique = Array.from(new Set(matches.filter(validateEmail)));
    if (unique.length > 0) return unique;
  }
  return [];
}

// Scrape phone, website, and address from the loaded detail panel
function scrapeDetailsPanel() {
  let address = 'N/A';
  let phone = 'N/A';
  let website = 'N/A';
  
  // 1. Extract Address
  const addressEl = document.querySelector('[data-item-id="address"]');
  if (addressEl) {
    address = addressEl.textContent.trim();
  } else {
    const addressButton = document.querySelector('button[aria-label*="Address:"]');
    if (addressButton) {
      address = addressButton.getAttribute('aria-label').replace('Address:', '').trim();
    }
  }
  
  // 2. Extract Phone Number
  const phoneEl = document.querySelector('[data-item-id^="phone:tel:"]');
  if (phoneEl) {
    phone = phoneEl.textContent.trim();
  } else {
    const phoneEl2 = document.querySelector('[data-item-id*="phone:tel:"]');
    if (phoneEl2) {
      phone = phoneEl2.textContent.trim();
    } else {
      const phoneLink = document.querySelector('a[href^="tel:"]');
      if (phoneLink) {
        phone = phoneLink.textContent.trim() || phoneLink.href.replace('tel:', '').trim();
      } else {
        const phoneButton = document.querySelector('button[aria-label*="Phone:"]');
        if (phoneButton) {
          phone = phoneButton.getAttribute('aria-label').replace('Phone:', '').trim();
        }
      }
    }
  }
  
  // 3. Extract Website URL
  const websiteEl = document.querySelector('[data-item-id="authority"]');
  if (websiteEl) {
    const anchor = websiteEl.tagName === 'A' ? websiteEl : websiteEl.querySelector('a');
    if (anchor && anchor.href) {
      website = cleanWebsiteUrl(anchor.href);
    } else if (websiteEl.href) {
      website = cleanWebsiteUrl(websiteEl.href);
    }
  } else {
    const websiteButton = document.querySelector('a[aria-label*="Website"]');
    if (websiteButton && websiteButton.href) {
      website = cleanWebsiteUrl(websiteButton.href);
    }
  }
  
  return { address, phone, website };
}

// Clean and decode redirects from Google URL shorteners
function cleanWebsiteUrl(url) {
  if (!url) return 'N/A';
  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.host.includes('google.com') && parsedUrl.pathname === '/url') {
      const qParam = parsedUrl.searchParams.get('q');
      if (qParam) {
        return qParam.split('?')[0];
      }
    }
  } catch (e) {
    // Ignore URL parsing errors
  }
  return url.split('?')[0];
}

// Scraper Loop orchestrator
async function startScraping() {
  logToPopup(`A1 Scraper active. Database Sync: ${dbSync ? 'ON' : 'OFF'}.`, 'system');
  
  const data = await getStorageData(['leads']);
  scrapedLeads = data.leads || [];
  scrapedUrls = new Set(scrapedLeads.map(l => l.mapsUrl));
  
  const scrollContainer = getScrollContainer();
  if (!scrollContainer) {
    logToPopup('Error: Results container not found. Make sure search results are loaded in the left panel.', 'error');
    isRunning = false;
    await saveState();
    return;
  }
  
  let noNewItemsCycles = 0;
  let lastScrollHeight = scrollContainer.scrollHeight;
  
  while (isRunning && scrapedLeads.length < limit) {
    const links = Array.from(scrollContainer.querySelectorAll('a[href*="/maps/place/"]'));
    
    for (let link of links) {
      if (!isRunning || scrapedLeads.length >= limit) break;
      
      const mapsUrl = link.href;
      if (scrapedUrls.has(mapsUrl)) continue;
      
      // Database check (if sync is enabled)
      if (dbSync) {
        const placeName = link.getAttribute('aria-label') || 'Business';
        logToPopup(`Checking database for duplicate: ${placeName}...`, 'info');
        const existsInDb = await checkDuplicateInDatabase(mapsUrl);
        if (existsInDb) {
          logToPopup(`Skipping (Already in Database): ${placeName}`, 'warning');
          scrapedUrls.add(mapsUrl);
          continue;
        }
      }
      
      const basicInfo = parseListing(link);
      
      if (mode === 'deep') {
        logToPopup(`Extracting details: ${basicInfo.name}...`, 'info');
        
        link.scrollIntoView({ block: 'center' });
        link.click();
        
        const detailsLoaded = await waitForDetailsPanel(basicInfo.name);
        
        if (detailsLoaded) {
          const details = scrapeDetailsPanel();
          let emailStr = 'N/A';
          
          let emails = checkEmailInMapsPanel();
          
          if (emails.length === 0 && emailScrape && details.website && details.website !== 'N/A') {
            logToPopup(`Searching website for emails: ${details.website}...`, 'info');
            const foundEmails = await requestEmailsFromBackground(details.website);
            if (foundEmails.length > 0) {
              emails = foundEmails;
            }
          }
          
          if (emails.length > 0) {
            emailStr = emails.join(', ');
            logToPopup(`Success: Found email(s) for ${basicInfo.name} -> ${emailStr}`, 'success');
          }
          
          const finalLead = {
            ...basicInfo,
            address: details.address,
            phone: details.phone,
            website: details.website,
            email: emailStr
          };
          
          scrapedLeads.push(finalLead);
          scrapedUrls.add(mapsUrl);
          
          logToPopup(`Scraped: ${finalLead.name} (${finalLead.phone !== 'N/A' ? 'Phone ✓' : 'No Phone'})`, 'success');
          
          // Save to Supabase (if sync is enabled)
          if (dbSync) {
            logToPopup(`Saving to database...`, 'info');
            const saved = await saveLeadToDatabase(finalLead);
            if (saved) {
              logToPopup(`Database Sync: Saved successfully!`, 'success');
            } else {
              logToPopup(`Database Sync Warning: Failed to save to Supabase. Lead is saved locally.`, 'warning');
            }
          }
        } else {
          const finalLead = {
            ...basicInfo,
            address: 'N/A',
            phone: 'N/A',
            website: 'N/A',
            email: 'N/A'
          };
          scrapedLeads.push(finalLead);
          scrapedUrls.add(mapsUrl);
          logToPopup(`Warning: Loading panel timed out for ${basicInfo.name}. Saved partial data.`, 'warning');
          
          if (dbSync) {
            await saveLeadToDatabase(finalLead);
          }
        }
      } else {
        // Fast mode
        const finalLead = {
          ...basicInfo,
          address: 'N/A',
          phone: 'N/A',
          website: 'N/A',
          email: 'N/A'
        };
        scrapedLeads.push(finalLead);
        scrapedUrls.add(mapsUrl);
        
        logToPopup(`Scraped: ${finalLead.name} (Fast Mode)`, 'success');
        
        if (dbSync) {
          logToPopup(`Saving to database...`, 'info');
          const saved = await saveLeadToDatabase(finalLead);
          if (saved) {
            logToPopup(`Database Sync: Saved successfully!`, 'success');
          } else {
            logToPopup(`Database Sync Warning: Failed to save to Supabase. Lead is saved locally.`, 'warning');
          }
        }
      }
      
      await saveState();
      await delay(mode === 'deep' ? 1200 : 300);
    }
    
    if (scrapedLeads.length >= limit) {
      logToPopup(`Target limit of ${limit} leads reached successfully!`, 'success');
      break;
    }
    
    logToPopup('Scrolling search list to load more results...', 'info');
    scrollContainer.scrollBy(0, 800);
    
    await delay(1800);
    
    const currentScrollHeight = scrollContainer.scrollHeight;
    if (currentScrollHeight === lastScrollHeight) {
      noNewItemsCycles++;
      if (noNewItemsCycles >= 5) {
        logToPopup('Reached the end of listings. No more results found.', 'warning');
        break;
      }
    } else {
      noNewItemsCycles = 0;
      lastScrollHeight = currentScrollHeight;
    }
    
    const footerText = document.querySelector('.HlvSq');
    if (footerText && footerText.textContent.includes("reached the end")) {
      logToPopup('Google Maps: You have reached the end of the list.', 'warning');
      break;
    }
  }
  
  isRunning = false;
  await saveState();
  logToPopup(`Scraping process finished. Scraped ${scrapedLeads.length} leads.`, 'system');
}
