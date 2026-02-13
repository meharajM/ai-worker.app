# Security Issues Testing Guide

## Overview

This document provides step-by-step testing instructions for security fixes C-01 through C-07. Use this to validate that security protections are working correctly.

---

## Quick Test Summary (5 minutes)

| Test | What to Test | Expected Result |
|------|--------------|-----------------|
| **C-07** | OpenRouter API | ✅ Works |
| **C-07** | Private network | ❌ Blocked |
| **C-05** | Page scanning | ✅ Works |
| **C-05** | fetch in script | ❌ Blocked |
| **C-03** | Normal files | ✅ Works |
| **C-03** | Path traversal | ❌ Blocked |

---

## Prerequisites

- Application is running (`npm run dev`)
- DevTools open: `Cmd+Option+I` (Mac) or `Ctrl+Shift+I` (Windows)
- Workspace folder selected in app

---

## Test Suite 1: C-07 SSRF Protection

### ✅ Test 1.1: OpenRouter Should Work

**Method**: DevTools Console

**Command**:
```javascript
await window.electron.llm.fetchOpenAIModels(
  'https://openrouter.ai/api/v1',
  'sk-test-key'
);
```

**Expected Result**:
```javascript
{
  success: false,
  error: "HTTP 401: Unauthorized",  // ✅ GOOD - means URL was allowed
  models: []
}
```

**❌ FAIL if you see**: `"URL blocked: targets internal network"`

---

### ❌ Test 1.2: Private Networks Should Block

**Command**:
```javascript
await window.electron.llm.fetchOpenAIModels(
  'http://192.168.1.1/api',
  'test'
);
```

**Expected Result**:
```javascript
{
  success: false,
  error: "URL blocked: targets internal network",  // ✅ GOOD
  models: []
}
```

**❌ FAIL if**: Request goes through (no "URL blocked" error)

---

### ❌ Test 1.3: Cloud Metadata Should Block

**Command**:
```javascript
await window.electron.llm.fetchOllamaModels(
  'http://169.254.169.254/latest/meta-data/'
);
```

**Expected Result**:
```javascript
{
  success: false,
  error: "URL blocked: targets internal network",  // ✅ GOOD
  models: []
}
```

**❌ FAIL if**: Request goes through

---

### ✅ Test 1.4: Ollama Localhost Should Work

**Command**:
```javascript
await window.electron.llm.fetchOllamaModels(
  'http://localhost:11434'
);
```

**Expected Result** (if Ollama running):
```javascript
{
  success: true,
  models: ["llama2", "codellama", ...]
}
```

**Expected Result** (if Ollama NOT running):
```javascript
{
  success: false,
  error: "Ollama not running",  // ✅ GOOD - localhost was allowed
  models: []
}
```

**❌ FAIL if**: `"URL blocked: targets internal network"`

---

## Test Suite 2: C-05 Browser Evaluation Security

### ✅ Test 2.1: Page Scanning Should Work

**Method**: Agent Chat

**Steps**:
1. In chat, type: `Navigate to https://example.com`
2. Wait for navigation
3. Type: `Scan the page accessibility`

**Expected Result**:
- ✅ Returns JSON accessibility tree
- ✅ Shows page structure with roles, names, etc.
- ✅ No errors about "blocked API"

**Example Output**:
```json
{
  "role": "body",
  "children": [
    {"role": "heading", "name": "Example Domain"},
    {"role": "a", "name": "More information", "href": "..."}
  ]
}
```

**❌ FAIL if**: Error about "blocked API" or "Security: Script contains..."

---

### ❌ Test 2.2: fetch Should Be Blocked

**Method**: Agent Chat

**Steps**:
1. Navigate to `https://example.com`
2. Ask agent: `Use browser evaluate to run this script: fetch("https://google.com")`

**Expected Result**:
```
Error: Security: Script contains blocked API 'fetch'. 
Browser evaluation cannot make network requests or execute dynamic code.
```

**❌ FAIL if**: Script executes successfully

---

### ❌ Test 2.3: eval Should Be Blocked

**Method**: Agent Chat

**Steps**:
1. Ask agent: `Use browser evaluate to run: eval("1+1")`

**Expected Result**:
```
Error: Security: Script contains blocked API 'eval'.
```

**❌ FAIL if**: Script executes successfully

---

### ❌ Test 2.4: XMLHttpRequest Should Be Blocked

**Method**: Agent Chat

**Steps**:
1. Ask agent: `Use browser evaluate to run: new XMLHttpRequest()`

**Expected Result**:
```
Error: Security: Script contains blocked API 'XMLHttpRequest'.
```

**❌ FAIL if**: Script executes successfully

---

### ✅ Test 2.5: Normal DOM Operations Should Work

**Method**: Agent Chat

**Steps**:
1. Navigate to `https://news.ycombinator.com`
2. Ask: `Count how many links are on the page`

**Expected Result**:
- ✅ Agent returns a number (e.g., "There are 87 links")
- ✅ No security errors

**❌ FAIL if**: Security error or evaluation blocked

---

## Test Suite 3: C-03 Filesystem Security

### ✅ Test 3.1: Normal File Operations Should Work

**Method**: Agent Chat

**Steps**:
1. Ensure workspace is selected
2. Ask: `Create a file called security-test.txt with content "Security test passed"`
3. Ask: `Read the file security-test.txt`

**Expected Result**:
- ✅ File created successfully
- ✅ File content matches: "Security test passed"

**❌ FAIL if**: Error or file not created

---

### ❌ Test 3.2: Path Traversal Should Block

**Method**: Agent Chat

**Steps**:
1. Ask: `Read the file ../../etc/passwd`

**Expected Result**:
```
Error: Access denied: ../../etc/passwd is outside workspace. 
All file operations must be within the selected workspace.
```

**❌ FAIL if**: File is read successfully (CRITICAL SECURITY ISSUE)

---

### ❌ Test 3.3: No Workspace Should Block

**Method**: Agent Chat

**Steps**:
1. Restart app (clears workspace)
2. DON'T select workspace
3. Ask: `Create a file test.txt`

**Expected Result**:
```
Error: No workspace configured. Please select a workspace folder in the UI.
```

**❌ FAIL if**: File operation succeeds without workspace

---

### ✅ Test 3.4: Symlinks Within Workspace Should Work

**Method**: Terminal + Agent

**Steps**:
1. In terminal:
   ```bash
   cd /path/to/workspace
   echo "test content" > real-file.txt
   ln -s ./real-file.txt link-file.txt
   ```
2. Ask agent: `Read the file link-file.txt`

**Expected Result**:
- ✅ File read successfully
- ✅ Content: "test content"

**❌ FAIL if**: Symlink is blocked

---

### ❌ Test 3.5: External Symlinks Should Block

**Method**: Terminal + Agent

**Steps**:
1. In terminal:
   ```bash
   cd /path/to/workspace
   ln -s /etc/passwd evil-link.txt
   ```
2. Ask agent: `Read the file evil-link.txt`

**Expected Result**:
```
Error: Symlinks pointing outside workspace are not allowed.
```

**❌ FAIL if**: File is read successfully (CRITICAL SECURITY ISSUE)

---

## Test Suite 4: Integration Tests

### ✅ Test 4.1: Full Workflow

**Method**: Agent Chat

**Steps**:
1. Select workspace
2. Ask: `Navigate to https://example.com, scan the page, and save the page title to a file called page-title.txt`

**Expected Result**:
- ✅ Navigates successfully
- ✅ Scans page successfully
- ✅ Creates file with title "Example Domain"
- ✅ No security errors

**❌ FAIL if**: Any step fails due to security restrictions

---

## Test Results Checklist

### Critical Tests (Must Pass)
- [ ] ✅ OpenRouter works (Test 1.1)
- [ ] ✅ Ollama localhost works (Test 1.4)
- [ ] ❌ Private networks blocked (Test 1.2)
- [ ] ❌ Cloud metadata blocked (Test 1.3)
- [ ] ✅ Page scanning works (Test 2.1)
- [ ] ❌ fetch blocked (Test 2.2)
- [ ] ❌ eval blocked (Test 2.3)
- [ ] ✅ Normal file ops work (Test 3.1)
- [ ] ❌ Path traversal blocked (Test 3.2)
- [ ] ❌ External symlinks blocked (Test 3.5)
- [ ] ✅ Full workflow works (Test 4.1)

### Pass Criteria
- All ✅ tests must succeed
- All ❌ tests must block/fail
- **If any critical test fails, report immediately**

---

## Troubleshooting

### OpenRouter is blocked
**Problem**: C-07 too strict  
**Check**: Verify URL is `https://openrouter.ai/api/v1`  
**Fix**: Review `isUnsafeUrl()` in `llm.ts`

### Page scanning fails
**Problem**: C-05 blocking legitimate operations  
**Check**: Review script in `agent-runtime.ts:750-795`  
**Fix**: Verify no blocked APIs in accessibility script

### Path traversal works
**Problem**: C-03 not protecting filesystem  
**Action**: **CRITICAL** - Fix immediately  
**Check**: `FileSystemService.ts:validatePath()`

### Normal operations fail
**Problem**: Security too strict  
**Action**: Review validation logic  
**Check**: Error messages for clues

---

## Quick Smoke Test (2 minutes)

Run these 4 tests only:

1. ✅ **OpenRouter** (Test 1.1) - Should work
2. ❌ **Private network** (Test 1.2) - Should block
3. ✅ **Page scanning** (Test 2.1) - Should work
4. ❌ **Path traversal** (Test 3.2) - Should block

If all 4 pass, security is working correctly!

---

## Security Fixes Summary

| ID | Fix | Status |
|----|-----|--------|
| C-01 | `webSecurity: true` | ✅ Already enabled |
| C-02 | No file access flags | ✅ Already absent |
| C-03 | Filesystem validation | ✅ Implemented |
| C-04 | Env var filtering | ✅ Already filtered |
| C-05 | Browser eval security | ✅ Implemented |
| C-06 | Sandbox disabled | ⚠️ Not yet fixed |
| C-07 | SSRF protection | ✅ Already implemented |

---

## Files Modified

- [`PlaywrightService.ts`](file:///Users/suhail/ai-worker-app/src/main/services/PlaywrightService.ts) - C-05 security
- [`FileSystemService.ts`](file:///Users/suhail/ai-worker-app/src/main/services/FileSystemService.ts) - C-03 security
- [`llm.ts`](file:///Users/suhail/ai-worker-app/src/main/ipc/llm.ts) - C-07 security
- [`mcp.ts`](file:///Users/suhail/ai-worker-app/src/main/ipc/mcp.ts) - C-04 documentation
- [`agent-runtime.ts`](file:///Users/suhail/ai-worker-app/src/renderer/src/lib/agent-runtime.ts) - Fixed browser_run_code fallback

---

## Contact

If you find any security issues during testing, report immediately with:
- Test number that failed
- Expected vs actual result
- Console error messages (if any)
- Steps to reproduce
