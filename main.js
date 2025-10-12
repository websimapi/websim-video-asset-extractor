document.addEventListener('DOMContentLoaded', () => {
    const videoUpload = document.getElementById('video-upload');
    const fileNameDisplay = document.getElementById('file-name');
    const videoPreview = document.getElementById('video-preview');
    const processButton = document.getElementById('process-button');
    const gridContainer = document.getElementById('grid-container');
    const rowsInput = document.getElementById('rows');
    const colsInput = document.getElementById('cols');
    const thresholdInput = document.getElementById('threshold');
    const thresholdValue = document.getElementById('threshold-value');

    let video;
    let animationFrameId;

    videoUpload.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (file) {
            const fileURL = URL.createObjectURL(file);
            videoPreview.src = fileURL;
            video = videoPreview;
            fileNameDisplay.textContent = file.name;
        }
    });

    thresholdInput.addEventListener('input', (event) => {
        thresholdValue.textContent = event.target.value;
    });

    processButton.addEventListener('click', () => {
        if (!video || !video.src || video.src.endsWith('placeholder.png')) {
            alert('Please upload a video first.');
            return;
        }

        // Stop any previous processing loop
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
        }
        
        video.play().then(() => {
            setupGridAndProcess();
        }).catch(err => {
            alert("Could not play video. Make sure you've interacted with the page.");
            console.error("Video play error:", err);
        });
    });

    function setupGridAndProcess() {
        const rows = parseInt(rowsInput.value);
        const cols = parseInt(colsInput.value);

        gridContainer.innerHTML = ''; // Clear previous grid
        gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

        const cellCanvases = [];
        for (let i = 0; i < rows * cols; i++) {
            const canvas = document.createElement('canvas');
            gridContainer.appendChild(canvas);
            cellCanvases.push(canvas);
        }

        const hiddenCanvas = document.createElement('canvas');
        const hiddenCtx = hiddenCanvas.getContext('2d', { willReadFrequently: true });

        const processVideo = () => {
            if (video.videoWidth === 0 || video.videoHeight === 0) {
                 // Video metadata not loaded yet, try again
                animationFrameId = requestAnimationFrame(processVideo);
                return;
            }

            hiddenCanvas.width = video.videoWidth;
            hiddenCanvas.height = video.videoHeight;
            const cellWidth = video.videoWidth / cols;
            const cellHeight = video.videoHeight / rows;

            cellCanvases.forEach(canvas => {
                if (canvas.width !== cellWidth || canvas.height !== cellHeight) {
                    canvas.width = cellWidth;
                    canvas.height = cellHeight;
                }
            });

            function processFrame() {
                if (video.paused || video.ended) {
                    animationFrameId = requestAnimationFrame(processFrame);
                    return;
                }

                hiddenCtx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight);

                const threshold = parseInt(thresholdInput.value);

                for (let r = 0; r < rows; r++) {
                    for (let c = 0; c < cols; c++) {
                        const cellIndex = r * cols + c;
                        const cellCanvas = cellCanvases[cellIndex];
                        const cellCtx = cellCanvas.getContext('2d');
                        
                        const sx = c * cellWidth;
                        const sy = r * cellHeight;

                        try {
                            const imageData = hiddenCtx.getImageData(sx, sy, cellWidth, cellHeight);
                            const data = imageData.data;

                            for (let i = 0; i < data.length; i += 4) {
                                const red = data[i];
                                const green = data[i + 1];
                                const blue = data[i + 2];

                                if (red <= threshold && green <= threshold && blue <= threshold) {
                                    // Set alpha to 0 for black/near-black pixels
                                    data[i + 3] = 0;
                                }
                            }
                            cellCtx.putImageData(imageData, 0, 0);
                        } catch (e) {
                            console.error(`Error processing cell (${r},${c}):`, e);
                            // Stop the loop on error to avoid flooding the console
                            cancelAnimationFrame(animationFrameId);
                            return;
                        }
                    }
                }

                animationFrameId = requestAnimationFrame(processFrame);
            }
            processFrame();
        };
        
        processVideo();
    }
});

