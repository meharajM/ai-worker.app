import React from 'react';

interface FormattedTextProps {
  content: string;
  className?: string;
}

/**
 * A simple component to render basic markdown-lite syntax:
 * - **bold**
 * - *italic*
 * - `code`
 * - [link](url)
 */
export function FormattedText({ content, className = '' }: FormattedTextProps) {
  if (!content) return null;

  // Split by potential markdown tokens to keep order
  // This is a simplified regex-based parser
  const parts = content.split(/(\*\*.*?\*\*|\*.*?\*|`.*?`|\[.*?\]\(.*?\))/g);

  return (
    <p className={`whitespace-pre-wrap break-words ${className}`}>
      {parts.map((part, index) => {
        // Bold: **text**
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={index} className="font-bold text-white">{part.slice(2, -2)}</strong>;
        }
        
        // Italic: *text*
        if (part.startsWith('*') && part.endsWith('*')) {
          return <em key={index} className="italic">{part.slice(1, -1)}</em>;
        }
        
        // Code: `text`
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={index} className="px-1.5 py-0.5 rounded bg-white/10 text-[#4fd1c5] font-mono text-[0.9em]">
              {part.slice(1, -1)}
            </code>
          );
        }
        
        // Link: [text](url)
        const linkMatch = part.match(/\[(.*?)\]\((.*?)\)/);
        if (linkMatch) {
          const [, text, url] = linkMatch;
          return (
            <a 
              key={index} 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer"
              className="text-[#4fd1c5] hover:underline cursor-pointer"
              onClick={(e) => {
                if (window.electron?.shell?.openExternal) {
                  e.preventDefault();
                  window.electron.shell.openExternal(url);
                }
              }}
            >
              {text}
            </a>
          );
        }

        // Plain text
        return <span key={index}>{part}</span>;
      })}
    </p>
  );
}
