import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface FormattedTextProps {
  content: string;
  className?: string;
}

/**
 * Renders Markdown using react-markdown with GitHub Flavored Markdown support.
 * Styled to match the "Gemini 3" aesthetic.
 */
export function FormattedText({ content, className = '' }: FormattedTextProps) {
  if (!content) return null;

  return (
    <div className={`prose prose-invert max-w-none text-sm leading-relaxed ${className}`}>
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
          li: ({ children }) => <li className="pl-1">{children}</li>,
          
          // Text formatting
          strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
          em: ({ children }) => <em className="italic text-white/80">{children}</em>,
          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
          
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
          
          // Code
          code: ({ inline, className, children, ...props }: any) => {
            const match = /language-(\w+)/.exec(className || '');
            return !inline ? (
              <div className="bg-black/30 rounded-lg p-3 my-2 border border-white/10 overflow-x-auto">
                <code className={`font-mono text-xs ${className}`} {...props}>
                  {children}
                </code>
              </div>
            ) : (
              <code className="px-1.5 py-0.5 rounded bg-white/10 text-[#4fd1c5] font-mono text-[0.9em]" {...props}>
                {children}
              </code>
            );
          },
          
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
