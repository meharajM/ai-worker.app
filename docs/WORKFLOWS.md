# Common Workflows in AI-Worker

This guide outlines common tasks and workflows you can perform using **AI-Worker**.

---

## 1. Local File Extraction & Research

This workflow allows you to drop research PDFs or spreadsheets into the workspace, extract contents, and compile structured notes using an LLM.

### Steps:
1. Drag and drop your files into the **Hub Chat** input area.
2. Ensure the `filesystem` and `MarkItDown` MCP servers are active in **MCP Connections**.
3. Type or speak your prompt:
   > "Extract all key metrics from the attached sales PDF, format it into a clean Markdown table, and save it to a new file called sales_summary.md."
4. The agent will read the file context, run the MarkItDown converter, format the table, and write the file back to your designated directory.

---

## 2. Stealth Browser Automation

Use this workflow to perform web research, take screenshots, or fill out web forms automatically.

### Steps:
1. Ensure the `playwright` MCP server is connected.
2. In the chat, issue a command:
   > "Search Google for the latest stock price of Apple, extract the price value, take a screenshot of the search page, and save it in my workspace."
3. The Playwright harness will launch an isolated browser session, navigate to Google, extract the target text, capture the screenshot, and save the file.

---

## 3. Remote WhatsApp Approval Loops

This workflow sets up a mobile communication link, allowing the agent to ask you for permission before executing a critical tool.

### Steps:
1. Go to **Hub Settings** and toggle **WhatsApp Integration** (if enabled/flagged).
2. Scan the generated QR code with your WhatsApp app to authenticate the session.
3. Start a long-running research or automation workflow on your desktop.
4. When the agent reaches a step requiring explicit approval, it sends a WhatsApp message to your phone:
   > *"The browser agent wants to submit the form at google.com. Do you approve? Reply YES or NO."*
5. Replying `YES` from your phone prompts the desktop client to proceed automatically.
