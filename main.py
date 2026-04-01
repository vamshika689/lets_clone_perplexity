from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from google import genai
import os
import tempfile
import io
import pypdf
import numpy as np
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Global state for simple RAG
global_pdf_chunks = []
global_pdf_embeddings = []

def chunk_text(text, chunk_size=250, overlap=50):
    words = text.split()
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i+chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
    return chunks

def cosine_similarity(v1, v2):
    return np.dot(v1, v2) / ((np.linalg.norm(v1) * np.linalg.norm(v2)) + 1e-10)

@app.post("/api/chat")
async def chat_with_gemini(
    prompt: str = Form(""),
    file: UploadFile = File(None)
):
    global global_pdf_chunks, global_pdf_embeddings
    try:
        client = genai.Client()
        contents = []
        is_pdf_processed_now = False

        if file:
            file_bytes = await file.read()
            
            if file.filename.lower().endswith('.pdf'):
                # Extract Text from PDF
                pdf_reader = pypdf.PdfReader(io.BytesIO(file_bytes))
                full_text = ""
                for page in pdf_reader.pages:
                    text = page.extract_text()
                    if text:
                        full_text += text + "\n"
                        
                chunks = chunk_text(full_text)
                if chunks:
                    # Embed all chunks
                    embed_response = client.models.embed_content(
                        model='text-embedding-004',
                        contents=chunks
                    )
                    
                    global_pdf_chunks = chunks
                    # The SDK usually returns `.embeddings[i].values` 
                    global_pdf_embeddings = [np.array(e.values) for e in embed_response.embeddings]
                
                is_pdf_processed_now = True
            else:
                # Non-PDF media uploads using Gemini native file handler
                with tempfile.NamedTemporaryFile(delete=False, suffix=f"_{file.filename}") as tmp:
                    tmp.write(file_bytes)
                    tmp_path = tmp.name
                
                uploaded_file = client.files.upload(file=tmp_path)
                contents.append(uploaded_file)
            
        final_prompt = prompt.strip()

        # If we have stored PDF data and a user prompt, retrieve relevant chunks
        if final_prompt and global_pdf_embeddings:
            prompt_res = client.models.embed_content(
                model='text-embedding-004',
                contents=final_prompt
            )
            prompt_vec = np.array(prompt_res.embeddings[0].values)
            
            # Simple vector similarity search
            similarities = [cosine_similarity(prompt_vec, chunk_vec) for chunk_vec in global_pdf_embeddings]
            top_indices = np.argsort(similarities)[-3:][::-1] # Get top 3 indices
            
            context_text = "\n\n---\n\n".join([global_pdf_chunks[i] for i in top_indices])
            
            # Augment prompt with retrieved chunks
            final_prompt = f"Use the following Context derived from an uploaded PDF to answer the query.\n\nContext:\n{context_text}\n\nQuery: {final_prompt}"

        # If user only uploaded a PDF with no prompt, inform them RAG is ready
        if is_pdf_processed_now and not prompt.strip():
            return JSONResponse({"reply": f"The PDF `{file.filename}` has been successfully parsed and indexed! Ask me any question about its contents."})

        if not contents and not final_prompt:
            return JSONResponse({"error": "No prompt or file provided."}, status_code=400)

        if final_prompt:
            contents.append(final_prompt)

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=contents,
        )
        return JSONResponse({"reply": response.text})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

# Serve the standard static files at root
app.mount("/", StaticFiles(directory=".", html=True), name="static")
