class FingerWriter {
    constructor() {
        this.initializeElements();
        this.initializeVariables();
        this.initializeEventListeners();
        this.initializeMediaPipe();
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
        
        // Drawing settings
        this.lineWidth = 3;
        this.strokeColor = '#2563eb';
        
        this.setupCanvas();
    }

    setupCanvas() {
        // Set canvas size
        this.drawingCanvas.width = 640;
        this.drawingCanvas.height = 400;
        this.outputCanvas.width = 640;
        this.outputCanvas.height = 400;
        
        // Drawing context settings
        this.drawingCtx.lineCap = 'round';
        this.drawingCtx.lineJoin = 'round';
        this.drawingCtx.lineWidth = 8; // Increased line width for better recognition
        this.drawingCtx.strokeStyle = this.strokeColor;
        this.drawingCtx.fillStyle = '#ffffff';
        this.drawingCtx.fillRect(0, 0, this.drawingCanvas.width, this.drawingCanvas.height);
    }

    initializeEventListeners() {
        this.startBtn.addEventListener('click', () => this.startCamera());
        this.clearBtn.addEventListener('click', () => this.clearCanvas());
        this.toggleDrawBtn.addEventListener('click', () => this.toggleDrawing());
        
        window.addEventListener('resize', () => this.handleResize());
    }

    initializeMediaPipe() {
        this.hands = new Hands({
            locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });

        this.hands.onResults((results) => this.onResults(results));
    }

    async startCamera() {
        try {
            this.updateStatus('Starting camera...', 'loading');
            this.startBtn.disabled = true;

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' }
            });

            this.videoElement.srcObject = stream;
            
            this.camera = new Camera(this.videoElement, {
                onFrame: async () => {
                    await this.hands.send({ image: this.videoElement });
                },
                width: 640,
                height: 480
            });

            await this.camera.start();
            
            this.updateStatus('Camera active - Show your hand!', 'active');
            this.startBtn.textContent = '📷 Camera Active';
            this.isInitialized = true;

        } catch (error) {
            console.error('Camera error:', error);
            this.updateStatus('Camera access error!', 'error');
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
            this.updateStatus('Drawing... ✍️', 'active');
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
                this.updateStatus('Ready to draw!', 'active');
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
        }, 1500); // Wait 1.5 seconds after drawing stops
    }

    async recognizeHandwriting() {
        this.updateStatus('Recognizing character...', 'loading');
        
        const imageDataUrl = this.preprocessImage();

        if (!imageDataUrl) {
            this.updateStatus('Draw a character first!', 'error');
            setTimeout(() => { if(this.isInitialized) this.updateStatus('Ready to draw!', 'active'); }, 1500);
            return;
        }

        try {
            const worker = await Tesseract.createWorker('eng', 1, {
                logger: m => console.log(m), // Log progress
            });
            await worker.setParameters({
                tessedit_pageseg_mode: '10', // PSM_SINGLE_CHAR
                tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
            });
            const { data } = await worker.recognize(imageDataUrl);
            await worker.terminate();

            if (data.text && data.text.trim().length > 0) {
                const recognizedChar = data.text.trim().replace(/\s/g, "")[0];
                if (recognizedChar) {
                    this.recognizedText += recognizedChar;
                    this.recognizedOutput.textContent = this.recognizedText;
                    this.confidenceScore.textContent = `${Math.round(data.confidence)}%`;
                    this.updateStatus('Character recognized!', 'active');

                    setTimeout(() => {
                        this.clearDrawingArea();
                        this.updateStatus('Ready for next character!', 'active');
                    }, 500);
                } else {
                    this.updateStatus('Could not recognize character.', 'error');
                    setTimeout(() => this.clearDrawingArea(), 500);
                }
            } else {
                this.updateStatus('Could not recognize character.', 'error');
                setTimeout(() => this.clearDrawingArea(), 500);
            }
        } catch (error) {
            console.error('Recognition error:', error);
            this.updateStatus('Recognition failed.', 'error');
        }
    }

    clearCanvas() {
        this.clearDrawingArea();
        this.recognizedText = '';
        
        this.updateStatus('Board cleared! 🧹', 'active');
        
        if (this.recognitionTimeout) clearTimeout(this.recognitionTimeout);
        this.recognizedOutput.textContent = '...';
        this.confidenceScore.textContent = 'N/A';

        setTimeout(() => {
            if (this.isInitialized) {
                this.updateStatus('Ready to draw!', 'active');
            } else {
                this.updateStatus('Waiting for camera...', 'loading');
            }
        }, 1500);
    }

    toggleDrawing() {
        this.isDrawingEnabled = !this.isDrawingEnabled;
        this.toggleDrawBtn.textContent = this.isDrawingEnabled ? '✏️ Drawing: ON' : '⏸️ Drawing: OFF';
        this.updateStatus(this.isDrawingEnabled ? 'Drawing is ON!' : 'Drawing is OFF.', 'active');
        if (!this.isDrawingEnabled) {
            this.stopDrawing();
        }
    }

    updateStatus(message, type) {
        if (this.statusText) {
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