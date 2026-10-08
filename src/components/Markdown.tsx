import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useState } from 'react';
import { services } from '../app/services';
export function Markdown({ text }: { text: string }) {
  const [failure, setFailure] = useState('');
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: () => null,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer noopener"
              onClick={(event) => {
                event.preventDefault();
                setFailure('');
                void services.platform.links
                  .open(href ?? '')
                  .catch(() =>
                    setFailure(
                      'Could not open this link. Only HTTP or HTTPS links without credentials are supported.',
                    ),
                  );
              }}
            >
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
      {failure && <p role="alert">{failure}</p>}
    </div>
  );
}
