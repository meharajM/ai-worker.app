# Quick Start — 5 Minutes to First Chat

Follow this express guide to get AI-Worker running on your local machine quickly. For detailed configuration options and platform requirements, see the full [Setup Guide](./setup.md).

## 🚀 Express Install

**1. Clone the repository**
```bash
git clone https://github.com/meharajM/ai-worker.app.git
cd ai-worker.app
```

**2. Install dependencies**
```bash
npm install
```

**3. Bootstrap system dependencies & MCP bindings**

* **On macOS & Linux:**
  ```bash
  chmod +x ./scripts/setup-dependencies.sh
  ./scripts/setup-dependencies.sh
  ```

* **On Windows (run PowerShell as Administrator):**
  ```powershell
  .\\scripts\\setup-dependencies.ps1
  ```

**4. Start the workspace**
```bash
npm run dev
```

---

## 🏁 Your First Conversation

1. When the app launches, it opens in your web browser at `http://localhost:5173`.
2. Go to **Hub Settings** (gear icon in sidebar).
3. Under **LLM Providers**, choose your preferred brain:
   * Select **Ollama** if you want to run completely locally (ensure Ollama is running on your machine with `qwen2.5:3b` pulled).
   * Or enter your API key for **OpenAI** or **Gemini**.
4. Go back to **Hub Chat** and type a message, or click the microphone icon to use **voice commands**.
5. Explore **MCP Connections** in the sidebar to view your connected tools (like local memory, browser automation, and filesystem).
