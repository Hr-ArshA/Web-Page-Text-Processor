// Create markdown file and download
async function saveAsMarkdown() {
  try {
    clearStatus();
    disableButtons();
    showStatus('Creating markdown file...');

    const tab = await getActiveTab();
    const [{ result: pageTitle }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => document.title
    });

    const resultText = document.getElementById('result').textContent;
    if (!resultText) {
      throw new Error('No processed text to save');
    }

    const text = await getFullPageText();
    const date = new Date().toISOString().split('T')[0];
    const source = new URL(tab.url).hostname;

    const markdownContent = `# ${pageTitle} - ${source}\n\nSummary or Persian Translation\nGenerated on: ${date}\n\n## Original Text\n\n${text}\n\n## Summary or Translation\n\n${resultText}`;

    const sanitizedTitle = pageTitle
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
    const filename = `${sanitizedTitle}-${source.toLowerCase()}-${date}.md`;

    const blob = new Blob([markdownContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);

    await chrome.downloads.download({
      url: url,
      filename: filename,
      saveAs: false
    });

    showStatus('File saved successfully!');
    setTimeout(() => {
      clearStatus();
    }, 3000);
  } catch (error) {
    console.error('Download error:', error);
    showError(error.message);
  } finally {
    enableButtons();
  }
}

// Add event listener for the save button
document.getElementById('saveMarkdownBtn').addEventListener('click', saveAsMarkdown);


async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function showError(message) {
  const errorDiv = document.getElementById('error');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

function showStatus(message) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
}

function clearStatus() {
  document.getElementById('status').textContent = '';
  document.getElementById('error').style.display = 'none';
}

function disableButtons() {
  document.querySelectorAll('button').forEach(btn => btn.disabled = true);
}

function enableButtons() {
  document.querySelectorAll('button').forEach(btn => btn.disabled = false);
}

function displayResult(content) {
  const resultDiv = document.getElementById('result');
  resultDiv.textContent = content;
}

// Text Extraction Functions
async function getSelectedText() {
  const tab = await getActiveTab();
  const [{ result: selectedText }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => window.getSelection().toString().trim()
  });
  return selectedText;
}

async function getFullPageText() {
  const tab = await getActiveTab();
  const [{ result: pageText }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: extractPageContent
  });
  return pageText;
}

function extractPageContent() {
  const article = document.querySelector('article');
  if (article) return article.innerText;
  
  const main = document.querySelector('main');
  if (main) return main.innerText;
  
  const text = Array.from(document.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6'))
    .map(el => el.innerText)
    .filter(text => text.length > 50)
    .join('\n\n');
    
  if (!text) {
    throw new Error('No suitable content found on the page');
  }
  
  return text;
}

// API Key Management
class ApiKeyManager {
  static async getSavedKeys() {
    const result = await chrome.storage.sync.get('apiKeys');
    return result.apiKeys || [];
  }

  static async saveKey(key) {
    if (!key) return false;
    
    const keys = await this.getSavedKeys();
    if (!keys.includes(key)) {
      keys.push(key);
      await chrome.storage.sync.set({ apiKeys: keys });
      await chrome.storage.sync.set({ selectedApiKey: key });
      return true;
    }
    return false;
  }

  static async deleteKey(key) {
    const keys = await this.getSavedKeys();
    const newKeys = keys.filter(k => k !== key);
    await chrome.storage.sync.set({ apiKeys: newKeys });
    
    // If the deleted key was selected, clear the selection
    const selected = await this.getSelectedKey();
    if (selected === key) {
      await chrome.storage.sync.remove('selectedApiKey');
    }
  }

  static async getSelectedKey() {
    const result = await chrome.storage.sync.get('selectedApiKey');
    return result.selectedApiKey || '';
  }

  static async setSelectedKey(key) {
    await chrome.storage.sync.set({ selectedApiKey: key });
  }
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async () => {
  const apiKeyInput = document.getElementById('apiKey');
  const savedApiKeysSelect = document.getElementById('savedApiKeys');
  const saveApiKeyBtn = document.getElementById('saveApiKey');

  // Load saved API keys
  const updateKeysList = async () => {
    const keys = await ApiKeyManager.getSavedKeys();
    const selectedKey = await ApiKeyManager.getSelectedKey();
    
    savedApiKeysSelect.innerHTML = '<option value="">Select a saved API key...</option>';
    
    keys.forEach(key => {
      const option = document.createElement('option');
      const maskedKey = `${key.substring(0, 4)}...${key.substring(key.length - 4)}`;
      option.value = key;
      option.textContent = maskedKey;
      if (key === selectedKey) {
        option.selected = true;
        apiKeyInput.value = key;
      }
      savedApiKeysSelect.appendChild(option);
    });
  };

  // Initial load
  await updateKeysList();

  // Save new API key
  saveApiKeyBtn.addEventListener('click', async () => {
    const newKey = apiKeyInput.value.trim();
    if (newKey) {
      const saved = await ApiKeyManager.saveKey(newKey);
      if (saved) {
        showStatus('API key saved successfully');
        await updateKeysList();
      } else {
        showStatus('API key already exists');
      }
    }
  });

  // Handle saved API key selection
  savedApiKeysSelect.addEventListener('change', async (e) => {
    const selectedKey = e.target.value;
    if (selectedKey) {
      await ApiKeyManager.setSelectedKey(selectedKey);
      apiKeyInput.value = selectedKey;
    } else {
      apiKeyInput.value = '';
    }
  });

  // Add context menu for deletion
  savedApiKeysSelect.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    const selectedKey = savedApiKeysSelect.value;
    if (selectedKey && confirm('Are you sure you want to delete this API key?')) {
      await ApiKeyManager.deleteKey(selectedKey);
      await updateKeysList();
      apiKeyInput.value = '';
      showStatus('API key deleted');
    }
  });
});

// API Interaction
async function sendToOpenRouter(text, action) {
  const selectedKey = await ApiKeyManager.getSelectedKey();
  const apiKey = selectedKey || document.getElementById('apiKey').value.trim();
  
  if (!apiKey) {
    throw new Error('Please enter or select an API key');
  }
  // Retrieve API key and model from input fields
  // const apiKey = document.getElementById('apiKey').value.trim();
  const model = document.getElementById('modelSelect').value;

  if (!apiKey) {
    throw new Error('Please enter your OpenRouter API key');
  }

  // Determine prompt based on action
  let prompt;
  switch(action) {
    case 'translate':
      prompt = `Translate the following text to Persian:\n${text}`;
      break;
    case 'summary':
      prompt = `Provide a concise summary of the following text:\n${text}`;
      break;
    case 'translate-summary':
      prompt = `First, provide a concise summary of the following text, then translate the Summarized text to Persian:\n${text}`;
      break;
    default:
      throw new Error('Invalid action');
  }

  const requestBody = {
    model: model,
    messages: [
      {
        "role": "user",
        "content": prompt
      }
    ],
    stream: false
  };

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://github.com/yourusername/extension',
        'X-Title': 'Chrome Extension Text Processor',
        'Accept': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    let responseText;
    try {
      responseText = await response.text();
      if (!response.ok) {
        try {
          const errorJson = JSON.parse(responseText);
          throw new Error(`API Error: ${errorJson.error?.message || 'Unknown error'}`);
        } catch (e) {
          throw new Error(`API request failed (${response.status}): Please check your API key and permissions`);
        }
      }
      
      const data = JSON.parse(responseText);
      if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error('Invalid response format from API');
      }
      
      return data.choices[0].message.content;
    } catch (parseError) {
      console.error('Raw API response:', responseText);
      throw parseError;
    }
  } catch (error) {
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
      throw new Error('Network error: Could not connect to OpenRouter API. Please check your internet connection.');
    }
    throw error;
  }
}

// Event Handlers
async function processText(getText, action) {
  try {
    clearStatus();
    disableButtons();
    showStatus('Processing...');

    const text = await getText();
    
    if (!text) {
      showError('No text found to process');
      return;
    }

    const result = await sendToOpenRouter(text, action);
    displayResult(result);
    showStatus('Processing complete');
  } catch (error) {
    console.error('Detailed error:', error);
    showError(error.message);
  } finally {
    enableButtons();
  }
}

// Button Event Listeners
document.getElementById('translatePageBtn').addEventListener('click', () => 
  processText(getFullPageText, 'translate')
);

document.getElementById('translateSelectionBtn').addEventListener('click', () => 
  processText(getSelectedText, 'translate')
);

document.getElementById('summaryPageBtn').addEventListener('click', () => 
  processText(getFullPageText, 'summary')
);

document.getElementById('summarySelectionBtn').addEventListener('click', () => 
  processText(getSelectedText, 'summary')
);

document.getElementById('translateSummaryPageBtn').addEventListener('click', () => 
  processText(getFullPageText, 'translate-summary')
);

document.getElementById('translateSummarySelectionBtn').addEventListener('click', () => 
  processText(getSelectedText, 'translate-summary')
);

// Load saved API key on popup open
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['openRouterApiKey'], (result) => {
    if (result.openRouterApiKey) {
      document.getElementById('apiKey').value = result.openRouterApiKey;
    }
  });

  // Save API key when changed
  document.getElementById('apiKey').addEventListener('change', (e) => {
    chrome.storage.sync.set({
      openRouterApiKey: e.target.value.trim()
    });
  });
});