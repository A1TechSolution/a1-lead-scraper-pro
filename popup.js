// Popup Controller for A1 Lead Scraper Pro

document.addEventListener('DOMContentLoaded', async () => {
  // DOM Elements
  const limitInput = document.getElementById('lead-limit');
  const modeToggle = document.getElementById('scrape-mode-toggle');
  const modeLabel = document.getElementById('mode-label');
  const modeDesc = document.getElementById('mode-description');
  
  const emailToggle = document.getElementById('email-scrape-toggle');
  const emailModeLabel = document.getElementById('email-mode-label');
  
  const dbSyncToggle = document.getElementById('db-sync-toggle');
  const dbSyncLabel = document.getElementById('db-sync-label');
  
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const scrapedCountEl = document.getElementById('scraped-count');
  const targetCountEl = document.getElementById('target-count');
  const progressFill = document.getElementById('progress-fill');
  
  const statWebsites = document.getElementById('stat-websites');
  const statPhones = document.getElementById('stat-phones');
  const statEmails = document.getElementById('stat-emails');
  
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnExportJson = document.getElementById('btn-export-json');
  
  const logBox = document.getElementById('log-box');
  const warningBanner = document.getElementById('wrong-page-warning');

  // Settings Panel Bindings
  const btnSettings = document.getElementById('btn-settings');
  const settingsDrawer = document.getElementById('settings-drawer');
  const inputSupaUrl = document.getElementById('input-supabase-url');
  const inputSupaKey = document.getElementById('input-supabase-key');
  const btnSaveSettings = document.getElementById('btn-save-settings');
  const btnClearSettings = document.getElementById('btn-clear-settings');

  let activeTabId = null;
  let targetTabId = null;

  // 1. Check if we are on Google Maps
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = tabs[0];
  
  const isGoogleMaps = activeTab && activeTab.url && (
    activeTab.url.includes('google.com/maps') || 
    activeTab.url.includes('google.co.uk/maps') ||
    activeTab.url.includes('google.ca/maps') ||
    activeTab.url.includes('google.com.au/maps') ||
    activeTab.url.includes('google.co.in/maps') ||
    activeTab.url.includes('google.de/maps') ||
    activeTab.url.includes('google.fr/maps') ||
    activeTab.url.includes('google.es/maps') ||
    activeTab.url.includes('google.it/maps') ||
    activeTab.url.includes('google.co.jp/maps') ||
    activeTab.url.includes('google.cat/maps')
  );

  if (isGoogleMaps) {
    activeTabId = activeTab.id;
  }

  // 2. Load current state from storage
  chrome.storage.local.get(['isScraping', 'leads', 'limit', 'mode', 'emailScrape', 'dbSync', 'scrapingTabId', 'supabaseUrl', 'supabaseKey', 'logs'], (data) => {
    // Populate settings
    if (data.limit) {
      limitInput.value = data.limit;
      targetCountEl.textContent = data.limit;
    }
    if (data.mode) {
      modeToggle.checked = data.mode === 'deep';
      updateModeUI(data.mode === 'deep');
    }
    if (data.emailScrape !== undefined) {
      emailToggle.checked = data.emailScrape;
      updateEmailUI(data.emailScrape);
    }
    
    // Populate Supabase credentials in settings inputs
    let hasCredentials = false;
    if (data.supabaseUrl && data.supabaseKey) {
      inputSupaUrl.value = data.supabaseUrl;
      inputSupaKey.value = data.supabaseKey;
      hasCredentials = true;
    }
    
    if (data.dbSync !== undefined && hasCredentials) {
      dbSyncToggle.checked = data.dbSync;
      updateDbSyncUI(data.dbSync);
    } else {
      dbSyncToggle.checked = false;
      updateDbSyncUI(false);
      if (!hasCredentials) {
        dbSyncLabel.textContent = 'No Keys';
      }
    }
    
    // Populate leads and status
    const leads = data.leads || [];
    const logs = data.logs || [];
    
    updateStats(leads);
    updateLogs(logs);
    
    const isScraping = !!data.isScraping;
    targetTabId = isScraping ? data.scrapingTabId : activeTabId;
    
    if (isScraping) {
      warningBanner.classList.add('hidden');
      setScrapingUI(true);
    } else {
      if (isGoogleMaps) {
        warningBanner.classList.add('hidden');
        setScrapingUI(false);
        if (!hasCredentials) {
          dbSyncToggle.disabled = true;
        }
      } else {
        warningBanner.classList.remove('hidden');
        setScrapingUI(false);
        // Disable controls since we are not on Google Maps
        btnStart.disabled = true;
        limitInput.disabled = true;
        modeToggle.disabled = true;
        emailToggle.disabled = true;
        dbSyncToggle.disabled = true;
        btnStop.disabled = true;
        addLogEntry('System Warning: Please perform a search on Google Maps before starting.', 'warning');
      }
      
      if (leads.length > 0) {
        addLogEntry(`Loaded ${leads.length} scraped leads from current session. Ready for download or to resume.`, 'info');
      }
    }
  });

  // 3. Toggle Handlers
  modeToggle.addEventListener('change', () => {
    const isDeep = modeToggle.checked;
    updateModeUI(isDeep);
    chrome.storage.local.set({ mode: isDeep ? 'deep' : 'fast' });
  });

  emailToggle.addEventListener('change', () => {
    const isEnabled = emailToggle.checked;
    updateEmailUI(isEnabled);
    chrome.storage.local.set({ emailScrape: isEnabled });
  });

  dbSyncToggle.addEventListener('change', () => {
    const isEnabled = dbSyncToggle.checked;
    updateDbSyncUI(isEnabled);
    chrome.storage.local.set({ dbSync: isEnabled });
  });

  // Settings Panel Click Handlers
  btnSettings.addEventListener('click', () => {
    settingsDrawer.classList.toggle('hidden');
  });

  btnSaveSettings.addEventListener('click', () => {
    const url = inputSupaUrl.value.trim();
    const key = inputSupaKey.value.trim();
    
    if (url && key) {
      chrome.storage.local.set({
        supabaseUrl: url,
        supabaseKey: key
      }, () => {
        dbSyncToggle.disabled = false;
        dbSyncToggle.checked = true;
        updateDbSyncUI(true);
        settingsDrawer.classList.add('hidden');
        addLogEntry('Supabase credentials saved successfully. Cloud sync is active.', 'success');
      });
    } else {
      alert('Please fill in both the Supabase URL and the Anon Key.');
    }
  });

  btnClearSettings.addEventListener('click', () => {
    inputSupaUrl.value = '';
    inputSupaKey.value = '';
    
    chrome.storage.local.remove(['supabaseUrl', 'supabaseKey'], () => {
      dbSyncToggle.checked = false;
      dbSyncToggle.disabled = true;
      updateDbSyncUI(false);
      dbSyncLabel.textContent = 'No Keys';
      settingsDrawer.classList.add('hidden');
      addLogEntry('Supabase credentials cleared. Cloud sync is disabled.', 'warning');
    });
  });

  function updateModeUI(isDeep) {
    if (isDeep) {
      modeLabel.textContent = 'Deep Scrape';
      modeDesc.textContent = 'Clicks each business listing to extract phone numbers, websites, and full addresses. Slower but extracts rich leads.';
    } else {
      modeLabel.textContent = 'Fast Scrape';
      modeDesc.textContent = 'Quickly extracts names, ratings, categories, and map links visible in search results without opening listing panels.';
    }
  }

  function updateEmailUI(isEnabled) {
    if (isEnabled) {
      emailModeLabel.textContent = 'Active';
    } else {
      emailModeLabel.textContent = 'Inactive';
    }
  }

  function updateDbSyncUI(isEnabled) {
    if (isEnabled) {
      dbSyncLabel.textContent = 'Active';
    } else {
      chrome.storage.local.get(['supabaseUrl', 'supabaseKey'], (res) => {
        const hasCredentials = !!(res.supabaseUrl && res.supabaseKey);
        dbSyncLabel.textContent = hasCredentials ? 'Inactive' : 'No Keys';
      });
    }
  }

  // 4. Update stats helper
  function updateStats(leads) {
    const total = leads.length;
    scrapedCountEl.textContent = total;
    
    const limit = parseInt(limitInput.value) || 100;
    targetCountEl.textContent = limit;
    
    const percentage = Math.min(100, (total / limit) * 100);
    progressFill.style.width = `${percentage}%`;
    
    let websites = 0;
    let phones = 0;
    let emails = 0;
    
    leads.forEach(lead => {
      if (lead.website && lead.website !== 'N/A') websites++;
      if (lead.phone && lead.phone !== 'N/A') phones++;
      if (lead.email && lead.email !== 'N/A' && lead.email !== '') emails++;
    });
    
    statWebsites.textContent = websites;
    statPhones.textContent = phones;
    statEmails.textContent = emails;
    
    // Enable exports if we have data
    btnExportCsv.disabled = total === 0;
    btnExportJson.disabled = total === 0;
  }

  // 5. Update UI for Scraping state
  function setScrapingUI(isScraping) {
    if (isScraping) {
      btnStart.disabled = true;
      btnStop.disabled = false;
      limitInput.disabled = true;
      modeToggle.disabled = true;
      emailToggle.disabled = true;
      dbSyncToggle.disabled = true;
      btnSettings.disabled = true;
      
      statusBadge.className = 'status-indicator active';
      statusText.textContent = 'Scraping';
    } else {
      btnStart.disabled = !isGoogleMaps;
      btnStop.disabled = true;
      limitInput.disabled = false;
      modeToggle.disabled = false;
      emailToggle.disabled = false;
      btnSettings.disabled = false;
      
      // Check if we have credentials before enabling dbSyncToggle
      chrome.storage.local.get(['supabaseUrl', 'supabaseKey', 'leads', 'limit'], (res) => {
        const hasCredentials = !!(res.supabaseUrl && res.supabaseKey);
        dbSyncToggle.disabled = !hasCredentials || !isGoogleMaps;
        if (!hasCredentials) {
          dbSyncToggle.checked = false;
          dbSyncLabel.textContent = 'No Keys';
        } else {
          dbSyncLabel.textContent = dbSyncToggle.checked ? 'Active' : 'Inactive';
        }
        
        const leads = res.leads || [];
        const limit = res.limit || 100;
        if (leads.length >= limit) {
          statusBadge.className = 'status-indicator success';
          statusText.textContent = 'Finished';
        } else {
          statusBadge.className = 'status-indicator';
          statusText.textContent = 'Idle';
        }
      });
    }
  }

  // 6. Action Listeners
  btnStart.addEventListener('click', () => {
    const limit = parseInt(limitInput.value) || 100;
    const mode = modeToggle.checked ? 'deep' : 'fast';
    const emailScrape = emailToggle.checked;
    const dbSync = dbSyncToggle.checked;
    
    // Clear previous scrape data if starting fresh
    chrome.storage.local.get(['leads'], (data) => {
      const leads = data.leads || [];
      
      const proceed = () => {
        logBox.innerHTML = '';
        const startMsg = `Starting A1 Lead Scraper... (Target: ${limit} leads, Mode: ${mode === 'deep' ? 'Deep' : 'Fast'}, Emails: ${emailScrape ? 'Enabled' : 'Disabled'}, DB Sync: ${dbSync ? 'ON' : 'OFF'})`;
        
        chrome.storage.local.set({
          isScraping: true,
          limit: limit,
          mode: mode,
          emailScrape: emailScrape,
          dbSync: dbSync,
          scrapingTabId: activeTabId,
          leads: [],
          logs: [startMsg]
        }, () => {
          targetTabId = activeTabId;
          setScrapingUI(true);
          warningBanner.classList.add('hidden');
          
          // Send message to content script
          chrome.tabs.sendMessage(activeTabId, {
            action: 'start',
            limit: limit,
            mode: mode,
            emailScrape: emailScrape,
            dbSync: dbSync
          }, (response) => {
            if (chrome.runtime.lastError) {
              addLogEntry('Error: Could not connect to Google Maps. Please refresh the page and try again.', 'warning');
              chrome.storage.local.set({ isScraping: false }, () => {
                setScrapingUI(false);
              });
            } else {
              addLogEntry('Connected to Google Maps active search tab.', 'success');
            }
          });
        });
      };
      
      if (leads.length > 0) {
        if (confirm(`You have ${leads.length} unsaved leads in this session. Start a new scrape job?`)) {
          proceed();
        }
      } else {
        proceed();
      }
    });
  });

  btnStop.addEventListener('click', () => {
    addLogEntry('Stopping scraper...', 'info');
    chrome.storage.local.set({ isScraping: false }, () => {
      setScrapingUI(false);
      
      chrome.storage.local.get(['scrapingTabId'], (data) => {
        const tabId = data.scrapingTabId || targetTabId;
        if (tabId) {
          chrome.tabs.sendMessage(tabId, { action: 'stop' }, (res) => {
            if (chrome.runtime.lastError) {
              // ignore
            }
            addLogEntry('Scraper stopped.', 'warning');
          });
        } else {
          addLogEntry('Scraper stopped.', 'warning');
        }
      });
    });
  });

  // 7. Storage Change Listener to Update UI Real-time
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    
    if (changes.leads) {
      updateStats(changes.leads.newValue || []);
    }
    
    if (changes.isScraping) {
      setScrapingUI(changes.isScraping.newValue);
    }
    
    if (changes.logs) {
      updateLogs(changes.logs.newValue || []);
    }
  });

  // Logs Helpers
  function addLogEntry(text, type = 'info') {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const formattedText = `[${timestamp}] ${text}`;
    
    chrome.storage.local.get(['logs'], (data) => {
      const logs = data.logs || [];
      logs.push(formattedText);
      if (logs.length > 150) logs.shift();
      chrome.storage.local.set({ logs: logs });
    });
  }

  function updateLogs(logs) {
    logBox.innerHTML = '';
    logs.forEach(log => {
      const div = document.createElement('div');
      div.className = 'log-entry';
      if (log.includes('Warning') || log.includes('Error')) {
        div.className += ' warning';
      } else if (log.includes('Success') || log.includes('Found') || log.includes('Scraped')) {
        div.className += ' success';
      } else if (log.includes('System') || log.includes('Starting') || log.includes('Stopping')) {
        div.className += ' system';
      } else {
        div.className += ' info';
      }
      div.textContent = log;
      logBox.appendChild(div);
    });
    logBox.scrollTop = logBox.scrollHeight;
  }

  // 8. Exports Handlers
  btnExportCsv.addEventListener('click', () => {
    chrome.storage.local.get(['leads'], (data) => {
      const leads = data.leads || [];
      if (leads.length === 0) return;
      
      const csvContent = convertToCSV(leads);
      downloadFile(csvContent, 'a1_maps_leads.csv', 'text/csv;charset=utf-8;');
    });
  });

  btnExportJson.addEventListener('click', () => {
    chrome.storage.local.get(['leads'], (data) => {
      const leads = data.leads || [];
      if (leads.length === 0) return;
      
      const jsonContent = JSON.stringify(leads, null, 2);
      downloadFile(jsonContent, 'a1_maps_leads.json', 'application/json;charset=utf-8;');
    });
  });

  function convertToCSV(objArray) {
    const array = typeof objArray !== 'object' ? JSON.parse(objArray) : objArray;
    let str = '';
    
    // Headers (Added Email)
    const headers = ['Name', 'Rating', 'Reviews Count', 'Category', 'Address', 'Phone', 'Website', 'Email', 'Maps URL'];
    str += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\r\n';
    
    // Data rows
    for (let i = 0; i < array.length; i++) {
      const item = array[i];
      const row = [
        item.name || 'N/A',
        item.rating || 'N/A',
        item.reviewsCount || 'N/A',
        item.category || 'N/A',
        item.address || 'N/A',
        item.phone || 'N/A',
        item.website || 'N/A',
        item.email || 'N/A',
        item.mapsUrl || 'N/A'
      ];
      
      str += row.map(val => `"${val.toString().replace(/"/g, '""')}"`).join(',') + '\r\n';
    }
    return str;
  }

  function downloadFile(content, fileName, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    }, 0);
  }
});
