// YouTube Video Dubbing Feature for Zepra Chrome Extension
// Complete implementation with Smart Wait injection mechanism

(function() {
  'use strict';

  // Configuration
  const IFLYTEK_LANGS = [
    'Arabic', 'English', 'Chinese', 'Japanese', 'German', 'Spanish', 
    'Korean', 'Russian', 'French', 'Portuguese', 'Italian', 'Hindi', 
    'Thai', 'Vietnamese', 'Indonesian', 'Turkish'
  ];

  // State management
  const DubbingState = {
    button: null,
    modal: null,
    observer: null,
    intervalId: null,
    isProcessing: false,
    originalVolume: 1,
    audioQueue: [],
    currentVideoId: null,
    dragState: {
      active: false,
      offsetX: 0,
      offsetY: 0,
      moved: false
    }
  };

  // ============= INITIALIZATION =============
  
  function initYouTubeDubbing() {
    // Only run on YouTube watch pages
    if (!location.hostname.includes('youtube.com') || !location.pathname.startsWith('/watch')) {
      console.log('Zepra Dubbing: Not a YouTube watch page, skipping initialization');
      return;
    }

    console.log('Zepra Dubbing: Initializing Video Dubbing feature...');
    
    // Clean up any existing instances
    cleanup();
    
    // Extract video ID
    DubbingState.currentVideoId = new URLSearchParams(location.search).get('v');
    
    // Start the Smart Wait injection
    startSmartWaitInjection();
  }

  // ============= SMART WAIT INJECTION =============
  
  function startSmartWaitInjection() {
    console.log('Zepra Dubbing: Starting Smart Wait injection mechanism...');
    
    // Try immediate injection
    if (tryInjectButton()) {
      console.log('Zepra Dubbing: Button injected immediately!');
      return;
    }
    
    // Set up MutationObserver (Primary method)
    setupMutationObserver();
    
    // Set up interval fallback (Secondary method)
    setupIntervalFallback();
  }

  function setupMutationObserver() {
    console.log('Zepra Dubbing: Setting up MutationObserver...');
    
    DubbingState.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          // Check if our target element has been added
          if (tryInjectButton()) {
            console.log('Zepra Dubbing: Button injected via MutationObserver!');
            cleanup(false); // Don't remove button
            return;
          }
        }
      }
    });
    
    // Observe the entire document for changes
    DubbingState.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  function setupIntervalFallback() {
    console.log('Zepra Dubbing: Setting up interval fallback...');
    
    let attempts = 0;
    const maxAttempts = 20; // 10 seconds maximum
    
    DubbingState.intervalId = setInterval(() => {
      attempts++;
      console.log(`Zepra Dubbing: Interval attempt ${attempts}/${maxAttempts}...`);
      
      if (tryInjectButton()) {
        console.log('Zepra Dubbing: Button injected via interval!');
        cleanup(false); // Don't remove button
      } else if (attempts >= maxAttempts) {
        console.error('Zepra Dubbing: Failed to inject button after maximum attempts');
        cleanup(true); // Clean everything
      }
    }, 500);
  }

  function tryInjectButton() {
    // Find the YouTube player
    const player = document.querySelector('.html5-video-player');
    if (!player) {
      console.log('Zepra Dubbing: Player not found yet');
      return false;
    }
    
    // Find the control bar
    const controls = player.querySelector('.ytp-right-controls');
    if (!controls) {
      console.log('Zepra Dubbing: Control bar not found yet');
      return false;
    }
    
    // Check if button already exists
    if (document.getElementById('zepra-dub-button')) {
      console.log('Zepra Dubbing: Button already exists');
      return true;
    }
    
    // Inject the button
    injectDubbingButton(controls, player);
    return true;
  }

  // ============= UI INJECTION =============
  
  function injectDubbingButton(controls, player) {
    console.log('Zepra Dubbing: Injecting dubbing button...');
    
    // Create the button
    const button = document.createElement('button');
    button.id = 'zepra-dub-button';
    button.className = 'ytp-button zepra-dub-button';
    button.title = 'Zepra Video Dubbing - Click or drag to reposition';
    button.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 36 36" fill="none">
        <circle cx="18" cy="18" r="16" fill="#111" stroke="#39ff14" stroke-width="2"/>
        <path d="M12 14.5C12 13.67 12.67 13 13.5 13H14.5C15.33 13 16 13.67 16 14.5V21.5C16 22.33 15.33 23 14.5 23H13.5C12.67 23 12 22.33 12 21.5V14.5Z" fill="#ffe600"/>
        <path d="M20 11.5C20 10.67 20.67 10 21.5 10H22.5C23.33 10 24 10.67 24 11.5V24.5C24 25.33 23.33 26 22.5 26H21.5C20.67 26 20 25.33 20 24.5V11.5Z" fill="#ffe600"/>
        <circle cx="18" cy="18" r="15" fill="none" stroke="#39ff14" stroke-width="1" opacity="0.5" class="pulse-ring"/>
      </svg>
    `;
    
    // Apply styles
    Object.assign(button.style, {
      width: '36px',
      height: '36px',
      marginLeft: '8px',
      cursor: 'grab',
      position: 'relative',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'transparent',
      border: 'none',
      outline: 'none',
      transition: 'transform 0.2s, filter 0.2s',
      filter: 'drop-shadow(0 0 4px #39ff14)'
    });
    
    // Add hover effects
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.1)';
      button.style.filter = 'drop-shadow(0 0 8px #39ff14)';
    });
    
    button.addEventListener('mouseleave', () => {
      if (!DubbingState.dragState.active) {
        button.style.transform = 'scale(1)';
        button.style.filter = 'drop-shadow(0 0 4px #39ff14)';
      }
    });
    
    // Insert before settings button
    const settingsBtn = controls.querySelector('.ytp-settings-button');
    controls.insertBefore(button, settingsBtn || controls.firstChild);
    
    // Set up drag functionality
    setupDragFunctionality(button, player);
    
    // Store reference
    DubbingState.button = button;
    
    console.log('Zepra Dubbing: Button successfully injected!');
  }

  // ============= DRAG FUNCTIONALITY =============
  
  function setupDragFunctionality(button, player) {
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      DubbingState.dragState.active = true;
      DubbingState.dragState.moved = false;
      DubbingState.dragState.offsetX = e.offsetX;
      DubbingState.dragState.offsetY = e.offsetY;
      
      button.style.cursor = 'grabbing';
      
      // Make button absolute positioned for dragging
      if (button.style.position !== 'absolute') {
        const rect = button.getBoundingClientRect();
        const playerRect = player.getBoundingClientRect();
        
        // Remove from controls and add to player
        button.remove();
        player.appendChild(button);
        
        Object.assign(button.style, {
          position: 'absolute',
          left: (rect.left - playerRect.left) + 'px',
          top: (rect.top - playerRect.top) + 'px',
          zIndex: '1000',
          marginLeft: '0'
        });
      }
      
      // Add document-level listeners
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
    });
    
    function onDragMove(e) {
      if (!DubbingState.dragState.active) return;
      
      DubbingState.dragState.moved = true;
      
      const playerRect = player.getBoundingClientRect();
      const buttonWidth = button.offsetWidth;
      const buttonHeight = button.offsetHeight;
      
      let x = e.clientX - playerRect.left - DubbingState.dragState.offsetX;
      let y = e.clientY - playerRect.top - DubbingState.dragState.offsetY;
      
      // Constrain to player boundaries
      x = Math.max(0, Math.min(x, playerRect.width - buttonWidth));
      y = Math.max(0, Math.min(y, playerRect.height - buttonHeight));
      
      button.style.left = x + 'px';
      button.style.top = y + 'px';
    }
    
    function onDragEnd(e) {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
      
      button.style.cursor = 'grab';
      button.style.transform = 'scale(1)';
      button.style.filter = 'drop-shadow(0 0 4px #39ff14)';
      
      // If not dragged, open modal
      if (!DubbingState.dragState.moved) {
        openDubbingModal();
      }
      
      DubbingState.dragState.active = false;
      DubbingState.dragState.moved = false;
    }
  }

  // ============= MODAL UI =============
  
  function openDubbingModal() {
    if (DubbingState.modal || DubbingState.isProcessing) {
      console.log('Zepra Dubbing: Modal already open or processing');
      return;
    }
    
    console.log('Zepra Dubbing: Opening dubbing modal...');
    
    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'zepra-dub-modal';
    modal.className = 'zepra-dub-modal';
    
    modal.innerHTML = `
      <div class="zepra-dub-modal-content">
        <div class="zepra-dub-modal-header">
          <h3>Zepra Video Dubbing</h3>
          <button class="zepra-dub-modal-close">&times;</button>
        </div>
        <div class="zepra-dub-modal-body">
          <div class="zepra-dub-control">
            <label for="zepra-dub-lang">Translate to:</label>
            <select id="zepra-dub-lang">
              ${IFLYTEK_LANGS.map(lang => 
                `<option value="${lang}">${lang}</option>`
              ).join('')}
            </select>
          </div>
          <button id="zepra-dub-start" class="zepra-dub-start-btn">
            Start Dubbing
          </button>
          <div id="zepra-dub-status" class="zepra-dub-status"></div>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    DubbingState.modal = modal;
    
    // Load saved language preference
    chrome.storage.local.get('dubDefaultLang', (data) => {
      if (data.dubDefaultLang) {
        document.getElementById('zepra-dub-lang').value = data.dubDefaultLang;
      }
    });
    
    // Event listeners
    modal.querySelector('.zepra-dub-modal-close').addEventListener('click', closeDubbingModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeDubbingModal();
    });
    
    document.getElementById('zepra-dub-start').addEventListener('click', startDubbing);
  }

  function closeDubbingModal() {
    if (DubbingState.modal) {
      DubbingState.modal.remove();
      DubbingState.modal = null;
    }
  }

  function updateStatus(message, type = 'info') {
    const statusEl = document.getElementById('zepra-dub-status');
    if (!statusEl) return;
    
    statusEl.className = `zepra-dub-status ${type}`;
    statusEl.innerHTML = message;
    
    console.log(`Zepra Dubbing Status [${type}]: ${message}`);
  }

  // ============= DUBBING WORKFLOW =============
  
  async function startDubbing() {
    if (DubbingState.isProcessing) {
      console.log('Zepra Dubbing: Already processing');
      return;
    }
    
    DubbingState.isProcessing = true;
    
    const startBtn = document.getElementById('zepra-dub-start');
    const lang = document.getElementById('zepra-dub-lang').value;
    
    // Save language preference
    chrome.storage.local.set({ dubDefaultLang: lang });
    
    startBtn.disabled = true;
    startBtn.textContent = 'Processing...';
    
    try {
      // Step 1: Fetch transcript
      updateStatus('Step 1/3: Fetching transcript...', 'loading');
      const transcript = await fetchTranscript();
      
      if (!transcript || transcript.length === 0) {
        throw new Error('No transcript available for this video');
      }
      
      console.log(`Zepra Dubbing: Retrieved ${transcript.length} transcript segments`);
      
      // Check cache first
      const cacheKey = `${DubbingState.currentVideoId}_${lang}`;
      const cachedAudio = await getCachedDubbing(cacheKey);
      
      if (cachedAudio) {
        console.log('Zepra Dubbing: Using cached audio');
        updateStatus('Success: Dubbing loaded from cache!', 'success');
        await playDubbedAudio(cachedAudio);
      } else {
        // Step 2: Translate
        updateStatus('Step 2/3: Translating text...', 'loading');
        const translations = await translateTranscript(transcript, lang);
        
        // Step 3: Generate audio
        updateStatus('Step 3/3: Generating audio...', 'loading');
        const audioSegments = await generateAudio(translations, lang);
        
        // Cache the result
        await cacheDubbing(cacheKey, audioSegments);
        
        // Play the dubbed audio
        updateStatus('Success: Dubbing complete! Playing...', 'success');
        await playDubbedAudio(audioSegments);
      }
      
    } catch (error) {
      console.error('Zepra Dubbing Error:', error);
      updateStatus(`Error: ${error.message}`, 'error');
    } finally {
      DubbingState.isProcessing = false;
      startBtn.disabled = false;
      startBtn.textContent = 'Start Dubbing';
    }
  }

  // ============= TRANSCRIPT RETRIEVAL =============
  
  async function fetchTranscript() {
    console.log('Zepra Dubbing: Fetching transcript...');
    
    // Method 1: Parse ytInitialPlayerResponse
    try {
      const transcript = await fetchFromYtInitialPlayerResponse();
      if (transcript && transcript.length > 0) {
        console.log('Zepra Dubbing: Transcript retrieved via ytInitialPlayerResponse');
        return transcript;
      }
    } catch (e) {
      console.warn('Zepra Dubbing: ytInitialPlayerResponse method failed:', e);
    }
    
    // Method 2: Scrape transcript panel
    try {
      const transcript = await scrapeTranscriptPanel();
      if (transcript && transcript.length > 0) {
        console.log('Zepra Dubbing: Transcript retrieved via panel scraping');
        return transcript;
      }
    } catch (e) {
      console.warn('Zepra Dubbing: Panel scraping method failed:', e);
    }
    
    // Method 3: Network request interception (via background script)
    try {
      const transcript = await fetchFromNetworkCapture();
      if (transcript && transcript.length > 0) {
        console.log('Zepra Dubbing: Transcript retrieved via network capture');
        return transcript;
      }
    } catch (e) {
      console.warn('Zepra Dubbing: Network capture method failed:', e);
    }
    
    throw new Error('No transcript available for this video');
  }

  async function fetchFromYtInitialPlayerResponse() {
    // Try to access the global variable first
    let playerResponse = window.ytInitialPlayerResponse;
    
    // If not available, try to extract from page scripts
    if (!playerResponse) {
      const scripts = Array.from(document.querySelectorAll('script'));
      for (const script of scripts) {
        if (script.textContent && script.textContent.includes('ytInitialPlayerResponse')) {
          const match = script.textContent.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);
          if (match) {
            try {
              playerResponse = JSON.parse(match[1]);
              break;
            } catch (e) {
              console.warn('Failed to parse ytInitialPlayerResponse:', e);
            }
          }
        }
      }
    }
    
    if (!playerResponse) {
      throw new Error('ytInitialPlayerResponse not found');
    }
    
    // Extract caption tracks
    const captionTracks = playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    
    if (!captionTracks || captionTracks.length === 0) {
      throw new Error('No caption tracks found');
    }
    
    // Get the first available track
    const trackUrl = captionTracks[0].baseUrl;
    
    // Fetch the captions
    const response = await fetch(trackUrl);
    const xmlText = await response.text();
    
    // Parse XML to extract transcript
    return parseTranscriptXML(xmlText);
  }

  async function scrapeTranscriptPanel() {
    // Check if transcript panel is open
    const panel = document.querySelector('ytd-transcript-renderer');
    
    if (!panel) {
      // Try to open it programmatically
      const menuButton = document.querySelector('.ytp-settings-button');
      if (menuButton) {
        menuButton.click();
        await new Promise(r => setTimeout(r, 500));
        
        const transcriptOption = Array.from(document.querySelectorAll('*'))
          .find(el => el.textContent && el.textContent.includes('Show transcript'));
        
        if (transcriptOption) {
          transcriptOption.click();
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }
    
    const segments = [];
    const segmentElements = document.querySelectorAll('ytd-transcript-segment-renderer');
    
    segmentElements.forEach(segment => {
      const timeStr = segment.querySelector('.segment-timestamp')?.textContent?.trim();
      const text = segment.querySelector('.segment-text')?.textContent?.trim();
      
      if (timeStr && text) {
        const time = parseTimeString(timeStr);
        segments.push({ start: time, text: text });
      }
    });
    
    if (segments.length === 0) {
      throw new Error('No transcript segments found in panel');
    }
    
    return segments;
  }

  async function fetchFromNetworkCapture() {
    // Request transcript from background script
    const response = await chrome.runtime.sendMessage({
      type: 'GET_CAPTURED_TRANSCRIPT',
      videoId: DubbingState.currentVideoId
    });
    
    if (!response || !response.ok) {
      throw new Error('No captured transcript available');
    }
    
    return parseTranscriptXML(response.xml);
  }

  function parseTranscriptXML(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
    const segments = [];
    
    const textElements = xmlDoc.getElementsByTagName('text');
    
    for (const element of textElements) {
      const start = parseFloat(element.getAttribute('start') || '0');
      const dur = parseFloat(element.getAttribute('dur') || '0');
      const text = element.textContent
        .replace(/\n/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .trim();
      
      if (text) {
        segments.push({
          start: start,
          duration: dur,
          text: text
        });
      }
    }
    
    return segments;
  }

  function parseTimeString(timeStr) {
    const parts = timeStr.split(':').reverse();
    let seconds = 0;
    
    parts.forEach((part, index) => {
      seconds += parseFloat(part) * Math.pow(60, index);
    });
    
    return seconds;
  }

  // ============= TRANSLATION =============
  
  async function translateTranscript(segments, targetLang) {
    console.log(`Zepra Dubbing: Translating ${segments.length} segments to ${targetLang}...`);
    
    const translations = [];
    const batchSize = 5; // Process in batches to avoid overwhelming the API
    
    for (let i = 0; i < segments.length; i += batchSize) {
      const batch = segments.slice(i, i + batchSize);
      const batchTexts = batch.map(seg => seg.text);
      
      const prompt = `
        Translate the following texts to ${targetLang}.
        Maintain the original meaning and tone.
        Return ONLY a JSON object with this exact format:
        {"translations": ["translated text 1", "translated text 2", ...]}
        
        Texts to translate:
        ${batchTexts.map((t, idx) => `${idx + 1}. ${t}`).join('\n')}
      `;
      
      const response = await chrome.runtime.sendMessage({
        type: 'CEREBRAS_GENERATE',
        prompt: prompt
      });
      
      if (!response || !response.ok) {
        throw new Error('Translation failed');
      }
      
      try {
        const result = JSON.parse(response.result);
        const batchTranslations = result.translations;
        
        // Combine with original timestamps
        batch.forEach((seg, idx) => {
          translations.push({
            ...seg,
            translatedText: batchTranslations[idx] || seg.text
          });
        });
      } catch (e) {
        console.error('Failed to parse translation response:', e);
        // Fallback: use original text
        batch.forEach(seg => {
          translations.push({
            ...seg,
            translatedText: seg.text
          });
        });
      }
      
      // Update progress
      const progress = Math.min(100, Math.round((i + batchSize) / segments.length * 100));
      updateStatus(`Step 2/3: Translating text... (${progress}%)`, 'loading');
    }
    
    return translations;
  }

  // ============= TEXT-TO-SPEECH =============
  
  async function generateAudio(segments, lang) {
    console.log(`Zepra Dubbing: Generating audio for ${segments.length} segments...`);
    
    // Get user settings
    const settings = await chrome.storage.local.get(['dubVoice', 'dubDialect', 'dubSpeed']);
    
    const audioSegments = [];
    
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      
      // Generate TTS
      const response = await chrome.runtime.sendMessage({
        type: 'IFLYTEK_TTS',
        text: segment.translatedText,
        opts: {
          lang: lang,
          voice: settings.dubVoice || 'default',
          dialect: settings.dubDialect || 'default',
          speed: settings.dubSpeed || 50
        }
      });
      
      if (!response || !response.ok) {
        console.warn(`Failed to generate audio for segment ${i}`);
        continue;
      }
      
      audioSegments.push({
        start: segment.start,
        duration: segment.duration,
        audio: response.audio
      });
      
      // Update progress
      const progress = Math.round((i + 1) / segments.length * 100);
      updateStatus(`Step 3/3: Generating audio... (${progress}%)`, 'loading');
    }
    
    return audioSegments;
  }

  // ============= AUDIO PLAYBACK =============
  
  async function playDubbedAudio(audioSegments) {
    console.log(`Zepra Dubbing: Playing ${audioSegments.length} audio segments...`);
    
    const video = document.querySelector('video');
    if (!video) {
      throw new Error('Video element not found');
    }
    
    // Store original volume and mute video
    DubbingState.originalVolume = video.volume;
    video.muted = true;
    
    // Clear any existing audio queue
    stopAllAudio();
    
    // Schedule audio playback based on timestamps
    const currentTime = video.currentTime;
    
    audioSegments.forEach(segment => {
      const delay = Math.max(0, (segment.start - currentTime) * 1000);
      
      const timeoutId = setTimeout(() => {
        const audio = new Audio(segment.audio);
        audio.volume = DubbingState.originalVolume;
        audio.play();
        
        // Store reference for cleanup
        DubbingState.audioQueue.push({ audio, timeoutId: null });
        
        // Remove from queue when finished
        audio.addEventListener('ended', () => {
          const index = DubbingState.audioQueue.findIndex(item => item.audio === audio);
          if (index > -1) {
            DubbingState.audioQueue.splice(index, 1);
          }
          
          // Restore video volume when all audio is done
          if (DubbingState.audioQueue.length === 0) {
            video.muted = false;
            video.volume = DubbingState.originalVolume;
          }
        });
      }, delay);
      
      DubbingState.audioQueue.push({ audio: null, timeoutId });
    });
    
    // Add video event listeners for sync
    video.addEventListener('pause', pauseAllAudio);
    video.addEventListener('play', resumeAllAudio);
    video.addEventListener('seeked', () => {
      stopAllAudio();
      playDubbedAudio(audioSegments);
    });
  }

  function stopAllAudio() {
    DubbingState.audioQueue.forEach(item => {
      if (item.timeoutId) {
        clearTimeout(item.timeoutId);
      }
      if (item.audio) {
        item.audio.pause();
        item.audio.currentTime = 0;
      }
    });
    DubbingState.audioQueue = [];
    
    // Restore video volume
    const video = document.querySelector('video');
    if (video) {
      video.muted = false;
      video.volume = DubbingState.originalVolume;
    }
  }

  function pauseAllAudio() {
    DubbingState.audioQueue.forEach(item => {
      if (item.audio && !item.audio.paused) {
        item.audio.pause();
      }
    });
  }

  function resumeAllAudio() {
    DubbingState.audioQueue.forEach(item => {
      if (item.audio && item.audio.paused) {
        item.audio.play();
      }
    });
  }

  // ============= CACHING =============
  
  async function getCachedDubbing(key) {
    return new Promise((resolve) => {
      const request = indexedDB.open('ZepraDubbingCache', 1);
      
      request.onerror = () => resolve(null);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('dubbing')) {
          db.createObjectStore('dubbing');
        }
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['dubbing'], 'readonly');
        const store = transaction.objectStore('dubbing');
        const getRequest = store.get(key);
        
        getRequest.onsuccess = () => {
          resolve(getRequest.result || null);
        };
        
        getRequest.onerror = () => resolve(null);
      };
    });
  }

  async function cacheDubbing(key, data) {
    return new Promise((resolve) => {
      const request = indexedDB.open('ZepraDubbingCache', 1);
      
      request.onerror = () => resolve(false);
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('dubbing')) {
          db.createObjectStore('dubbing');
        }
      };
      
      request.onsuccess = (event) => {
        const db = event.target.result;
        const transaction = db.transaction(['dubbing'], 'readwrite');
        const store = transaction.objectStore('dubbing');
        const putRequest = store.put(data, key);
        
        putRequest.onsuccess = () => resolve(true);
        putRequest.onerror = () => resolve(false);
      };
    });
  }

  // ============= CLEANUP =============
  
  function cleanup(removeButton = true) {
    // Clear observers
    if (DubbingState.observer) {
      DubbingState.observer.disconnect();
      DubbingState.observer = null;
    }
    
    // Clear interval
    if (DubbingState.intervalId) {
      clearInterval(DubbingState.intervalId);
      DubbingState.intervalId = null;
    }
    
    // Stop all audio
    stopAllAudio();
    
    // Remove UI elements if requested
    if (removeButton) {
      if (DubbingState.button) {
        DubbingState.button.remove();
        DubbingState.button = null;
      }
      
      closeDubbingModal();
    }
  }

  // ============= EVENT LISTENERS =============
  
  // Handle YouTube navigation
  window.addEventListener('yt-navigate-finish', () => {
    console.log('Zepra Dubbing: YouTube navigation detected');
    setTimeout(initYouTubeDubbing, 1000);
  });

  // Handle page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      pauseAllAudio();
    } else {
      resumeAllAudio();
    }
  });

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initYouTubeDubbing);
  } else {
    initYouTubeDubbing();
  }

  // Export for testing
  window.ZepraDubbing = {
    init: initYouTubeDubbing,
    cleanup: cleanup,
    getState: () => DubbingState
  };

})();
