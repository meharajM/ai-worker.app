# Contributing to AI-Worker

First off, thank you for considering contributing to AI-Worker! It's people like you that make AI-Worker such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to team@aiworker.app.

## How Can I Contribute?

### Reporting Bugs 🐛

Before creating bug reports, please check the [issue list](https://github.com/meharajM/ai-worker.app/issues) as you might find out that you don't need to create one. When you are creating a bug report, please include as many details as possible:

* **Use a clear and descriptive title**
* **Describe the exact steps which reproduce the problem** in as many details as possible
* **Provide specific examples to demonstrate the steps** Include links to files or GitHub projects, or copy/paste snippets
* **Describe the behavior you observed after following the steps** and explain the problem with that behavior
* **Explain which behavior you expected to see instead and why**
* **Include screenshots and animated GIFs if possible**
* **Include your environment details**:
  - OS and version
  - Node.js version
  - AI-Worker version
  - Python version (if using MCP servers)

### Suggesting Enhancements 💡

Enhancement suggestions are tracked as [GitHub issues](https://github.com/meharajM/ai-worker.app/issues). When creating an enhancement suggestion, please include:

* **Use a clear and descriptive title**
* **Provide a step-by-step description of the suggested enhancement** in as many details as possible
* **Provide specific examples to demonstrate the steps**
* **Describe the current behavior** and **explain the expected behavior**
* **Explain why this enhancement would be useful**
* **List some other applications where this enhancement exists**

### Pull Requests 🔄

Please follow these steps to have your contribution considered by the maintainers:

1. **Fork** the repository
2. **Clone** your fork locally
   ```bash
   git clone https://github.com/YOUR-USERNAME/ai-worker.app.git
   cd ai-worker.app
   ```

3. **Create a branch** for your changes
   ```bash
   git checkout -b feature/your-feature-name
   ```

4. **Install dependencies**
   ```bash
   npm install
   ```

5. **Make your changes**
   - Follow the [Coding Standards](#coding-standards) below
   - Write meaningful commit messages
   - Add comments for complex logic

6. **Test your changes**
   ```bash
   npm run lint
   npm run typecheck
   npm run test:e2e
   ```

7. **Push to your fork**
   ```bash
   git push origin feature/your-feature-name
   ```

8. **Create a Pull Request**
   - Use a clear and descriptive title
   - Reference any related issues (e.g., "Fixes #123")
   - Include a description of the changes
   - Follow the PR template provided

## Coding Standards

### Style Guide

* Use **TypeScript** for all new code
* Follow the existing code style in the repository
* Use **meaningful variable and function names**
* Keep functions **small and focused**
* Add **comments** for complex logic

### Linting & Formatting

We use **ESLint** for linting. Before submitting a PR:

```bash
# Check for linting issues
npm run lint

# Auto-fix linting issues
npm run lint:fix

# Type check
npm run typecheck
```

### Git Commit Messages

* Use the present tense ("Add feature" not "Added feature")
* Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
* Limit the first line to 72 characters or less
* Reference issues and pull requests liberally after the first line
* Follow conventional commit format: `type(scope): description`

#### Commit Types

* `feat`: A new feature
* `fix`: A bug fix
* `docs`: Documentation only changes
* `style`: Changes that do not affect the meaning of the code (formatting, etc)
* `refactor`: A code change that neither fixes a bug nor adds a feature
* `perf`: A code change that improves performance
* `test`: Adding missing tests or correcting existing tests
* `chore`: Changes to build process, dependencies, or tools

#### Examples

```
feat(voice): add voice command support for file operations
fix(mcp): resolve connection timeout issue with memory server
docs: update MCP integration guide with new examples
refactor(ui): simplify chat component state management
perf(renderer): optimize voice processing pipeline
```

## Development Setup

### Prerequisites

* **Node.js** ≥ 22.12.0
* **npm** or **yarn**
* **Git**
* **Python 3** (optional, for MCP servers)

### Setup Instructions

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Setup development environment**
   ```bash
   npm run hooks:install
   ```

3. **Start development server**
   ```bash
   npm run dev
   ```

4. **In a separate terminal, watch for changes**
   ```bash
   npm run build
   ```

### Testing

```bash
# Run all E2E tests
npm run test:e2e

# Run mock UI tests
npm run test:mock

# Run speech tests
npm run test:speech

# Run specific test
node tests/integration_test.cjs
```

## Project Structure

```
ai-worker.app/
├── src/
│   ├── main/          # Electron main process
│   ├── preload/       # Preload scripts
│   ├── renderer/      # React components
│   └── agents/        # AI agent implementations
├── tests/             # Test files
├── scripts/           # Build and dev scripts
├── docs/              # Documentation
└── build/             # Build assets
```

## Review Process

1. **Code Review**: At least one maintainer will review your PR
2. **Tests**: All tests must pass
3. **Linting**: Code must pass linting checks
4. **Type Checking**: No TypeScript errors
5. **Feedback**: Address any feedback from reviewers
6. **Merge**: Once approved, your PR will be merged

## Additional Notes

### Issue and Pull Request Labels

This section lists the labels we use to help organize and categorize issues and pull requests.

* **bug** - Something isn't working
* **enhancement** - New feature or request
* **documentation** - Improvements or additions to documentation
* **good first issue** - Good for newcomers
* **help wanted** - Extra attention is needed
* **question** - Further information is requested
* **wontfix** - This will not be worked on

## Recognition

Contributors are recognized in:
* Release notes
* README.md contributors section (for significant contributions)
* GitHub contributors graph

## Questions?

Feel free to:
* Open an issue for questions
* Email team@aiworker.app
* Start a discussion on GitHub

---

Thank you for contributing to AI-Worker! 🚀
