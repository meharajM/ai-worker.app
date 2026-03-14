import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check, Terminal } from 'lucide-react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from '../lib/utils';

interface FormattedTextProps {
  content: string;
  className?: string;
}

const CodeBlock = ({ inline, className, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match?.[1] || 'text';
  const codeContent = String(children).replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Clipboard write failed, trying fallback:', err);
        // Fallback
        const textArea = document.createElement("textarea");
        textArea.value = codeContent;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            setCopied(true);
             setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Fallback copy failed', err);
        }
        document.body.removeChild(textArea);
    }
  };

  const isSingleLine = !codeContent.includes('\n');
  const isShort = codeContent.length < 50;
  const isTextOrUnknown = language === 'text' || !match;

  // Render compact version for short, single-line text snippets (like flags or simple commands)
  if (!inline && isSingleLine && isShort && isTextOrUnknown) {
      // Determine if it's "super short" (like a flag -r or command cp)
      const isSuperShort = codeContent.length < 10;
      
      return (
          <div className="relative group/code my-1 inline-block align-middle">
               <div className={cn(
                   "flex items-center gap-2 bg-[#1e1e1e] border border-[var(--color-border)] rounded-md px-2 py-1",
                   isSuperShort ? "px-1.5 py-0.5" : ""
               )}>
                   <code className="font-mono text-xs text-[#ce9178] flex-1 break-all">
                       {codeContent}
                   </code>
                   {!isSuperShort && (
                       <button
                            onClick={handleCopy}
                            className="p-0.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-all opacity-0 group-hover/code:opacity-100"
                            title="Copy"
                        >
                            {copied ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                        </button>
                   )}
               </div>
          </div>
      )
  }

  if (!inline) {
    return (
      <div className="relative group/code my-4 rounded-xl bg-[#1e1e1e] border border-[var(--color-border)] overflow-hidden shadow-sm">
        {/* Header / Language Badge */}
        <div className="flex items-center justify-between px-3 py-2 bg-[#252526] border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Terminal size={12} className="text-white/50" />
            <span className="text-[11px] font-medium text-white/60 font-mono tracking-wide">
              {language}
            </span>
          </div>
          <button
            onClick={handleCopy}
            className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white transition-all flex items-center gap-1.5"
            title="Copy code"
          >
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
            <span className="text-[10px] opacity-0 group-hover/code:opacity-100 transition-opacity">
              {copied ? 'Copied!' : 'Copy'}
            </span>
          </button>
        </div>
        
        {/* Code Content */}
        <div className="text-xs">
           <SyntaxHighlighter
            style={vscDarkPlus}
            language={language}
            PreTag="div"
            customStyle={{
                margin: 0,
                padding: '16px',
                background: 'transparent',
                fontSize: '12px',
                lineHeight: '1.5',
            }}
            wrapLines={true}
            wrapLongLines={true} // Wrap long lines to avoid horizontal scroll for better UX
            {...props}
          >
            {codeContent}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  }

  return (
    <code 
        className={cn(
            "px-1.5 py-0.5 rounded bg-[var(--color-surface-hover)] border border-[var(--color-border)] text-[var(--color-brand-teal)] font-mono text-[0.9em]",
            className
        )} 
        {...props}
    >
      {children}
    </code>
  );
};

/**
 * Renders Markdown using react-markdown with GitHub Flavored Markdown support.
 * Styled to match the "Gemini 3" aesthetic.
 */
export function FormattedText({ content, className = '' }: FormattedTextProps) {
  if (!content) return null;

  return (
    <div className={`prose prose-invert max-w-none text-sm leading-relaxed ${className} select-text`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Headers - Gemini style: clear separation
          h1: ({ children }) => <h1 className="text-lg font-bold text-[var(--color-text-primary)] mt-4 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold text-[var(--color-text-primary)] mt-4 mb-2 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[13px] font-bold text-[var(--color-text-secondary)] mt-3 mb-1.5 uppercase tracking-wide">{children}</h3>,
          
          // Lists - proper spacing and bullets
          ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 my-2 text-[var(--color-text-secondary)]">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 my-2 text-[var(--color-text-secondary)]">{children}</ol>,
          li: ({ children }) => <li className="pl-1 text-[var(--color-text-secondary)]">{children}</li>,
          
          // Text formatting
          strong: ({ children }) => <strong className="font-bold text-[var(--color-text-primary)]">{children}</strong>,
          em: ({ children }) => <em className="italic text-[var(--color-text-secondary)]">{children}</em>,
          p: ({ children }) => <p className="mb-2 last:mb-0 text-[var(--color-text-primary)] leading-relaxed">{children}</p>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-[var(--color-brand-teal)] pl-4 italic text-[var(--color-text-muted)] my-2">{children}</blockquote>,
          
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[var(--color-brand-teal)] hover:underline cursor-pointer font-medium"
              onClick={(e) => {
                if (window.electron?.shell?.openExternal && href) {
                  e.preventDefault();
                  window.electron.shell.openExternal(href);
                }
              }}
            >
              {children}
            </a>
          ),
          
          // Code with Copy Button
          code: CodeBlock,
          
          table: ({ children }) => <div className="overflow-x-auto my-3"><table className="min-w-full divide-y divide-[var(--color-border)] border border-[var(--color-border)] rounded-lg text-left">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-[var(--color-surface)]">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-[var(--color-border)]">{children}</tbody>,
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-xs text-[var(--color-text-primary)] whitespace-nowrap">{children}</td>,
          
          // Horizontal Rule
          hr: () => <hr className="border-[var(--color-border)] my-4" />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
