import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Check } from 'lucide-react';

interface FormattedTextProps {
  content: string;
  className?: string;
}

const CodeBlock = ({ inline, className, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const codeContent = String(children).replace(/\n$/, '');

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return !inline ? (
    <div className="relative group/code my-4 rounded-lg bg-black/30 border border-white/10 overflow-hidden">
      {/* Header / Language Badge */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-white/5 border-b border-white/5">
        <span className="text-[10px] uppercase font-medium text-white/40 font-mono">
          {match?.[1] || 'text'}
        </span>
        <button
          onClick={handleCopy}
          className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-all flex items-center gap-1.5"
          title="Copy code"
        >
          {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          <span className="text-[10px]">{copied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
      
      {/* Code Content */}
      <div className="overflow-x-auto p-3">
        <code className={`font-mono text-xs ${className}`} {...props}>
          {children}
        </code>
      </div>
    </div>
  ) : (
    <code className="px-1.5 py-0.5 rounded bg-white/10 text-[#4fd1c5] font-mono text-[0.9em]" {...props}>
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
          h1: ({ children }) => <h1 className="text-lg font-bold text-white mt-4 mb-2 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold text-white mt-4 mb-2 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[13px] font-bold text-white/90 mt-3 mb-1.5 uppercase tracking-wide">{children}</h3>,
          
          // Lists - proper spacing and bullets
          ul: ({ children }) => <ul className="list-disc pl-4 space-y-1 my-2 text-white/90">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-4 space-y-1 my-2 text-white/90">{children}</ol>,
          li: ({ children }) => <li className="pl-1 text-white/80">{children}</li>,
          
          // Text formatting
          strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-white/80">{children}</em>,
          p: ({ children }) => <p className="mb-2 last:mb-0 text-white/90">{children}</p>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-[#00a896] pl-4 italic text-white/60 my-2">{children}</blockquote>,
          
          // Links
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#4fd1c5] hover:underline cursor-pointer font-medium"
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
          
          table: ({ children }) => <div className="overflow-x-auto my-3"><table className="min-w-full divide-y divide-white/10 border border-white/10 rounded-lg text-left">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-white/5">{children}</thead>,
          tbody: ({ children }) => <tbody className="divide-y divide-white/5">{children}</tbody>,
          tr: ({ children }) => <tr>{children}</tr>,
          th: ({ children }) => <th className="px-3 py-2 text-xs font-semibold text-white/70 uppercase tracking-wider">{children}</th>,
          td: ({ children }) => <td className="px-3 py-2 text-xs text-white/80 whitespace-nowrap">{children}</td>,
          
          // Horizontal Rule
          hr: () => <hr className="border-white/10 my-4" />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
