document.addEventListener("DOMContentLoaded", () => {
    const askInput = document.querySelector("#ask-input");
    const mainContent = document.querySelector(".main-content");
    const bottomArea = document.querySelector(".bottom-area");
    const uploadBtn = document.querySelector("#upload-btn");
    const micBtn = document.querySelector("#mic-btn");
    const sendBtn = document.querySelector("#send-btn");
    const mediaUpload = document.querySelector("#media-upload");
    const attachmentStatus = document.querySelector("#attachment-status");

    // Create a chat history container
    const chatHistory = document.createElement("div");
    chatHistory.className = "chat-history";
    // Insert it before the bottom area
    bottomArea.parentNode.insertBefore(chatHistory, bottomArea);

    let selectedFile = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;

    // File Upload Handler
    uploadBtn.addEventListener("click", () => mediaUpload.click());

    mediaUpload.addEventListener("change", (e) => {
        if (e.target.files.length > 0) {
            selectedFile = e.target.files[0];
            attachmentStatus.textContent = `Attached: ${selectedFile.name}`;
            attachmentStatus.style.display = "block";
        }
    });

    // Mic Recording Handler
    micBtn.addEventListener("click", async () => {
        if (!isRecording) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                mediaRecorder.start();
                isRecording = true;
                audioChunks = [];
                
                micBtn.style.color = "#ff453a"; // Recording red
                attachmentStatus.textContent = "Recording audio... (tap mic again to stop)";
                attachmentStatus.style.display = "block";

                mediaRecorder.ondataavailable = e => {
                    audioChunks.push(e.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    // Create a File from Blob
                    selectedFile = new File([audioBlob], "voice_note.webm", { type: 'audio/webm' });
                    attachmentStatus.textContent = "Attached: Voice Note (webm)";
                    micBtn.style.color = ""; // Reset color
                    // Automatically stop tracking device streams
                    stream.getTracks().forEach(track => track.stop());
                };
            } catch (err) {
                console.error(err);
                alert("Microphone access denied or unavailable.");
            }
        } else {
            mediaRecorder.stop();
            isRecording = false;
        }
    });

    async function sendMessage() {
        if (askInput.value.trim() === "" && !selectedFile) return;

        const prompt = askInput.value.trim();
        askInput.value = "";
        
        // Hide logo if first message
        if (mainContent.style.display !== "none") {
            mainContent.style.display = "none";
            chatHistory.style.display = "flex";
        }

        let userMsg = prompt;
        if (selectedFile) {
            userMsg += userMsg ? `\n[Attached: ${selectedFile.name}]` : `[Attached: ${selectedFile.name}]`;
        }

        // Append user message
        addMessage(userMsg, "user");

        // Add loading indicator
        const loadingId = addMessage("Thinking...", "ai", true);

        // Construct FormData for multipart uploading
        const formData = new FormData();
        formData.append("prompt", prompt);
        if (selectedFile) {
            formData.append("file", selectedFile);
        }

        // Reset attachment state immediately
        selectedFile = null;
        mediaUpload.value = "";
        attachmentStatus.style.display = "none";

        try {
            // Notice we omit 'Content-Type', fetch automatically sets it with boundary for FormData
            const response = await fetch("/api/chat", {
                method: "POST",
                body: formData
            });

            const data = await response.json();
            
            // Replace loading with real response
            updateMessage(loadingId, data.reply || data.error);

        } catch (err) {
            updateMessage(loadingId, "Error connecting to server. Is it running?");
        }
    }

    sendBtn.addEventListener("click", sendMessage);

    askInput.addEventListener("keydown", async (e) => {
        if (e.key === "Enter") {
            e.preventDefault(); 
            sendMessage();
        }
    });

    function addMessage(text, sender, isLoading = false) {
        const msgDiv = document.createElement("div");
        msgDiv.className = `chat-message ${sender}-message`;
        msgDiv.textContent = text;
        const msgId = 'msg-' + Date.now();
        msgDiv.id = msgId;
        
        if (isLoading) {
            msgDiv.classList.add("loading");
        }
        
        chatHistory.appendChild(msgDiv);
        chatHistory.scrollTop = chatHistory.scrollHeight;
        return msgId;
    }

    function updateMessage(id, text) {
        const msgDiv = document.getElementById(id);
        if (msgDiv) {
            msgDiv.textContent = text;
            msgDiv.classList.remove("loading");
            chatHistory.scrollTop = chatHistory.scrollHeight;
        }
    }
});
