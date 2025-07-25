class FingerWriter {
    constructor() {
        this.currentLang = localStorage.getItem('finger-drawing-lang') || 'en';
        this.initializeElements();
        this.initializeVariables();
        this.initializeEventListeners();
        this.initializeMediaPipe();
        this.setLanguage(this.currentLang);
    }

    initializeElements() {
        // Video elements
        this.videoElement = document.getElementById('input_video');
        this.outputCanvas = document.getElementById('output_canvas');
        this.outputCtx = this.outputCanvas.getContext('2d');
        
        // Drawing canvas
        this.drawingCanvas = document.getElementById('drawing_canvas');
        this.drawingCtx = this.drawingCanvas.getContext('2d');
        
        // Buttons
        this.startBtn = document.getElementById('start_btn');
        this.clearBtn = document.getElementById('clear_btn');
        this.toggleDrawBtn = document.getElementById('toggle_draw');
        this.langBtn = document.getElementById('lang_btn');
        
        // Status elements
        this.statusDot = document.getElementById('status_indicator');
        this.statusText = document.getElementById('status_text');
        
        // AI elements
        this.recognizedOutput = document.getElementById('recognized_output');
        this.confidenceScore = document.getElementById('confidence_score');
    }

    initializeVariables() {
        this.isDrawing = false;
        this.isDrawingEnabled = true;
        this.lastPoint = null;
        this.camera = null;
        this.hands = null;
        this.isInitialized = false;
        this.recognitionTimeout = null;
        this.recognizedText = '';
        this.tesseractWorker = null;

        // Drawing settings
        this.lineWidth = 3; // This one is for resize, might keep it dynamic
        this.strokeColor = FINGER_WRITER_CONSTANTS.STROKE_COLOR;
        
        this.setupCanvas();
    }

    setupCanvas() {
        // Set canvas size
        this.drawingCanvas.width = FINGER_WRITER_CONSTANTS.CANVAS_WIDTH;
        this.drawingCanvas.height = FINGER_WRITER_CONSTANTS.CANVAS_HEIGHT;
        this.outputCanvas.width = FINGER_WRITER_CONSTANTS.CANVAS_WIDTH;
        this.outputCanvas.height = FINGER_WRITER_CONSTANTS.CANVAS_HEIGHT;
        
        // Drawing context settings
        this.drawingCtx.lineCap = 'round';
        this.drawingCtx.lineJoin = 'round';
        this.drawingCtx.lineWidth = FINGER_WRITER_CONSTANTS.DRAWING_LINE_WIDTH;
        this.drawingCtx.strokeStyle = this.strokeColor;
        this.drawingCtx.fillStyle = '#ffffff';
        this.drawingCtx.fillRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
    }

    initializeEventListeners() {
        this.startBtn.addEventListener('click', () => this.toggleCamera());
        this.clearBtn.addEventListener('click', () => this.clearCanvas());
        this.toggleDrawBtn.addEventListener('click', () => this.toggleDrawing());
        this.langBtn.addEventListener('click', () => this.toggleLanguage());
        
        window.addEventListener('resize', () => this.handleResize());
    }

    initializeMediaPipe() {
        this.hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: FINGER_WRITER_CONSTANTS.HAND_CONFIDENCE,
            minTrackingConfidence: FINGER_WRITER_CONSTANTS.HAND_CONFIDENCE
        });

        this.hands.onResults((results) => this.onResults(results));
    }

    toggleLanguage() {
        const newLang = this.currentLang === 'en' ? 'tr' : 'en';
        this.setLanguage(newLang);
    }

    setLanguage(lang) {
        this.currentLang = lang;
        localStorage.setItem('finger-drawing-lang', lang);
        const t = translations[lang];

        document.querySelectorAll('[data-lang-key]').forEach(el => {
            const key = el.dataset.langKey;
            if (key in t) {
                if (key === 'confidence') {
                    // Update only the text node to prevent destroying the span element
                    // and invalidating the this.confidenceScore reference.
                    el.childNodes[0].nodeValue = t[key] + ' ';
                    
                    // If the score is not a number (e.g., it's "N/A" or empty), update it with the new translation
                    if (!this.confidenceScore.textContent.includes('%')) {
                        this.confidenceScore.textContent = t.confidenceNA;
                    }
                } else {
                    el.innerHTML = t[key];
                }
            }
        });

        // Update dynamic button texts not covered by simple keys
        this.updateDynamicTexts();
    }
    
    updateDynamicTexts() {
        const t = translations[this.currentLang];
        
        // Start/Stop button
        if (this.isInitialized) {
            this.startBtn.innerHTML = t.stopCamera;
        } else {
            this.startBtn.innerHTML = t.startCamera;
        }

        // Drawing On/Off button
        if (this.isDrawingEnabled) {
            this.toggleDrawBtn.innerHTML = t.drawingOn;
        } else {
            this.toggleDrawBtn.innerHTML = t.drawingOff;
        }

        // Update status text with the correct language
        // We'll update the status text generation in the updateStatus function directly
    }

    async toggleCamera() {
        if (this.isInitialized) {
            this.stopCamera();
        } else {
            await this.startCamera();
        }
    }

    stopCamera() {
        if (!this.isInitialized) return;

        this.updateStatus('statusStopping', FINGER_WRITER_CONSTANTS.STATUS.LOADING);

        if (this.camera) {
            this.camera.stop();
            this.camera = null;
        }

        const stream = this.videoElement.srcObject;
        if (stream) {
            stream.getTracks().forEach(track => track.stop());
            this.videoElement.srcObject = null;
        }

        this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
        this.stopDrawing();
        this.isInitialized = false;

        this.startBtn.textContent = translations[this.currentLang].startCamera;
        this.startBtn.disabled = false;
        this.updateStatus('statusOff', FINGER_WRITER_CONSTANTS.STATUS.LOADING);
    }

    async startCamera() {
        try {
            this.updateStatus('statusStarting', FINGER_WRITER_CONSTANTS.STATUS.LOADING);
            this.startBtn.disabled = true;

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { 
                    width: FINGER_WRITER_CONSTANTS.VIDEO_WIDTH, 
                    height: FINGER_WRITER_CONSTANTS.VIDEO_HEIGHT, 
                    facingMode: 'user' 
                }
            });

            this.videoElement.srcObject = stream;
            
            this.camera = new Camera(this.videoElement, {
                onFrame: async () => {
                    await this.hands.send({ image: this.videoElement });
                },
                width: FINGER_WRITER_CONSTANTS.VIDEO_WIDTH,
                height: FINGER_WRITER_CONSTANTS.VIDEO_HEIGHT
            });

            await this.camera.start();
            
            this.updateStatus('statusActive', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);
            this.startBtn.textContent = translations[this.currentLang].stopCamera;
            this.isInitialized = true;
            this.startBtn.disabled = false;

        } catch (error) {
            console.error('Camera error:', error);
            this.updateStatus('statusError', FINGER_WRITER_CONSTANTS.STATUS.ERROR);
            this.startBtn.textContent = translations[this.currentLang].startCamera;
            this.startBtn.disabled = false;
        }
    }

    onResults(results) {
        this.outputCtx.clearRect(0, 0, this.outputCanvas.width, this.outputCanvas.height);
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            this.processHandLandmarks(landmarks);
            this.drawHandLandmarks(landmarks);
        } else {
            this.stopDrawing();
            this.drawingCanvas.parentElement.classList.remove('drawing-mode');
        }
    }

    processHandLandmarks(landmarks) {
        if (!this.isDrawingEnabled) return;

        const isWriting = this.detectWritingGesture(landmarks);
        
        if (isWriting) {
            const indexTip = landmarks[8];
            const x = (1 - indexTip.x) * this.drawingCanvas.width;
            const y = indexTip.y * this.drawingCanvas.height;
            this.drawPoint(x, y);
            this.drawingCanvas.parentElement.classList.add('drawing-mode');
        } else {
            this.stopDrawing();
            this.drawingCanvas.parentElement.classList.remove('drawing-mode');
        }
    }

    detectWritingGesture(landmarks) {
        const indexTip = landmarks[8];
        const indexPip = landmarks[6];
        return indexTip.y < indexPip.y;
    }

    drawPoint(x, y) {
        if (!this.isDrawing) {
            this.isDrawing = true;
            this.updateStatus('statusDrawing', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);
        }
        
        this.drawingCtx.beginPath();
        if (this.lastPoint) {
            this.drawingCtx.moveTo(this.lastPoint.x, this.lastPoint.y);
        } else {
            this.drawingCtx.moveTo(x, y);
        }
        this.drawingCtx.lineTo(x, y);
        this.drawingCtx.stroke();

        this.lastPoint = { x, y };
    }

    stopDrawing() {
        if (this.isDrawing) {
            this.isDrawing = false;
            this.lastPoint = null;
            if (this.isInitialized) {
                this.updateStatus('statusReady', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);
                this.scheduleRecognition();
            }
        }
    }

    drawHandLandmarks(landmarks) {
        drawConnectors(this.outputCtx, landmarks, HAND_CONNECTIONS, {color: '#00FF00', lineWidth: 5});
        drawLandmarks(this.outputCtx, landmarks, {color: '#FF0000', lineWidth: 2});
        
        const indexTip = landmarks[8];
        this.outputCtx.fillStyle = '#0066ff';
        this.outputCtx.beginPath();
        this.outputCtx.arc((1 - indexTip.x) * this.outputCanvas.width, indexTip.y * this.outputCanvas.height, 8, 0, 2 * Math.PI);
        this.outputCtx.fill();
    }

    preprocessImage() {
        const sourceCanvas = this.drawingCanvas;
        const ctx = sourceCanvas.getContext('2d');
        const imageData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
        const data = imageData.data;
        
        let minX = sourceCanvas.width, minY = sourceCanvas.height, maxX = -1, maxY = -1;

        // Find bounding box of the drawing
        for (let y = 0; y < sourceCanvas.height; y++) {
            for (let x = 0; x < sourceCanvas.width; x++) {
                const i = (y * sourceCanvas.width + x) * 4;
                // Check if pixel is not white
                if (data[i] !== 255 || data[i+1] !== 255 || data[i+2] !== 255) {
                    minX = Math.min(x, minX);
                    maxX = Math.max(x, maxX);
                    minY = Math.min(y, minY);
                    maxY = Math.max(y, maxY);
                }
            }
        }

        if (maxX === -1) { // No drawing found
            return null;
        }

        const charWidth = maxX - minX;
        const charHeight = maxY - minY;
        const padding = 20;
        
        const newSize = Math.max(charWidth, charHeight) + padding * 2;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = newSize;
        tempCanvas.height = newSize;
        const tempCtx = tempCanvas.getContext('2d');
        
        // Center the character on the new canvas
        tempCtx.fillStyle = '#ffffff';
        tempCtx.fillRect(0, 0, newSize, newSize);
        tempCtx.drawImage(
            sourceCanvas, 
            minX, minY, charWidth, charHeight, // source rect
            padding, padding, charWidth, charHeight // destination rect
        );

        // Binarize: make it pure black and white
        const finalImageData = tempCtx.getImageData(0, 0, newSize, newSize);
        const finalData = finalImageData.data;
        for (let i = 0; i < finalData.length; i += 4) {
            const isWhite = finalData[i] > 250 && finalData[i+1] > 250 && finalData[i+2] > 250;
            if (!isWhite) {
                finalData[i] = 0; // R
                finalData[i+1] = 0; // G
                finalData[i+2] = 0; // B
            }
        }
        tempCtx.putImageData(finalImageData, 0, 0);
        
        return tempCanvas.toDataURL('image/png');
    }

    clearDrawingArea() {
        this.drawingCtx.fillStyle = '#ffffff';
        this.drawingCtx.fillRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
        this.stopDrawing();
    }

    scheduleRecognition() {
        if (this.recognitionTimeout) {
            clearTimeout(this.recognitionTimeout);
        }
        this.recognitionTimeout = setTimeout(() => {
            this.recognizeHandwriting();
        }, FINGER_WRITER_CONSTANTS.RECOGNITION_DELAY); // Wait after drawing stops
    }

    async getTesseractWorker() {
        if (this.tesseractWorker) {
            return this.tesseractWorker;
        }

        this.updateStatus('statusRecognizing', FINGER_WRITER_CONSTANTS.STATUS.LOADING); // Use a more generic "initializing AI" message
        
        const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => console.log(m),
        });
        await worker.setParameters({
            tessedit_pageseg_mode: '10', // PSM_SINGLE_CHAR
            tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
        });
        
        this.tesseractWorker = worker;
        return this.tesseractWorker;
    }

    async recognizeHandwriting() {
        this.updateStatus('statusRecognizing', FINGER_WRITER_CONSTANTS.STATUS.LOADING);
        
        const imageDataUrl = this.preprocessImage();

        if (!imageDataUrl) {
            this.updateStatus('statusNoChar', FINGER_WRITER_CONSTANTS.STATUS.ERROR);
            setTimeout(() => { if(this.isInitialized) this.updateStatus('statusReady', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE); }, FINGER_WRITER_CONSTANTS.STATUS_UPDATE_DELAY);
            return;
        }

        try {
            const worker = await this.getTesseractWorker();
            const { data } = await worker.recognize(imageDataUrl);

            if (data.text && data.text.trim().length > 0) {
                const recognizedChar = data.text.trim().replace(/\s/g, "")[0];
                if (recognizedChar) {
                    this.recognizedText += recognizedChar;
                    this.recognizedOutput.textContent = this.recognizedText;
                    this.confidenceScore.textContent = `${Math.round(data.confidence)}%`;
                    this.updateStatus('statusRecognized', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);

                    setTimeout(() => {
                        this.clearDrawingArea();
                        this.updateStatus('statusReadyNext', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);
                    }, FINGER_WRITER_CONSTANTS.POST_RECOGNITION_CLEAR_DELAY);
                } else {
                    this.updateStatus('statusNotRecognized', FINGER_WRITER_CONSTANTS.STATUS.ERROR);
                    setTimeout(() => this.clearDrawingArea(), FINGER_WRITER_CONSTANTS.POST_RECOGNITION_CLEAR_DELAY);
                }
            } else {
                this.updateStatus('statusNotRecognized', FINGER_WRITER_CONSTANTS.STATUS.ERROR);
                setTimeout(() => this.clearDrawingArea(), FINGER_WRITER_CONSTANTS.POST_RECOGNITION_CLEAR_DELAY);
            }
        } catch (error) {
            console.error('Recognition error:', error);
            this.updateStatus('statusRecognitionFailed', FINGER_WRITER_CONSTANTS.STATUS.ERROR);
        }
    }

    clearCanvas() {
        this.clearDrawingArea();
        this.recognizedText = '';
        
        this.updateStatus('statusCleared', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);
        
        if (this.recognitionTimeout) clearTimeout(this.recognitionTimeout);
        this.recognizedOutput.textContent = '...';
        this.confidenceScore.textContent = translations[this.currentLang].confidenceNA;

        setTimeout(() => {
            if (this.isInitialized) {
                this.updateStatus('statusReady', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);
            } else {
                this.updateStatus('statusWaiting', FINGER_WRITER_CONSTANTS.STATUS.LOADING);
            }
        }, FINGER_WRITER_CONSTANTS.STATUS_UPDATE_DELAY);
    }

    toggleDrawing() {
        this.isDrawingEnabled = !this.isDrawingEnabled;
        this.toggleDrawBtn.textContent = this.isDrawingEnabled ? translations[this.currentLang].drawingOn : translations[this.currentLang].drawingOff;
        this.updateStatus(this.isDrawingEnabled ? 'statusDrawingOn' : 'statusDrawingOff', FINGER_WRITER_CONSTANTS.STATUS.ACTIVE);
        if (!this.isDrawingEnabled) {
            this.stopDrawing();
        }
    }

    updateStatus(messageKey, type) {
        if (this.statusText) {
            const message = translations[this.currentLang][messageKey] || messageKey;
            this.statusText.textContent = message;
        }
        if (this.statusDot) {
            this.statusDot.className = `status-dot ${type || ''}`;
        }
    }

    handleResize() {
        this.lineWidth = (window.innerWidth <= 768) ? 4 : 3;
        this.drawingCtx.lineWidth = this.lineWidth;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const fingerWriter = new FingerWriter();
    console.log('🚀 Finger Drawing Application Started!');
}); 