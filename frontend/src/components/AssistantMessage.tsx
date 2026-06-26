import { useMemo, useState } from "react";
import "./AssistantMessage.css";

export interface Citation {
  id: string;
  title: string;
  url: string;
}

interface AssistantMessageProps {
  content: string;
  citations?: Citation[];
  loading?: boolean;
}

const FOOTNOTE_DEF = /^\[\^(\d+)\]:\s*\[([^\]]*)\]\(([^)]+)\)\s*$/gm;
const TOKEN_RE = /(\[\^\d+\]|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*)/g;

export function extractCitations(text: string): Citation[] {
  const found: Citation[] = [];
  for (const match of text.matchAll(FOOTNOTE_DEF)) {
    found.push({
      id: match[1],
      title: match[2].trim(),
      url: match[3].trim(),
    });
  }
  return found;
}

function CitationMark({ citation }: { citation: Citation }) {
  return (
    <span className="citation-wrap">
      <a
        className="citation-mark"
        href={citation.url}
        target="_blank"
        rel="noreferrer"
        aria-label={`Source: ${citation.title}`}
      >
        •
      </a>
      <span className="citation-tooltip" role="tooltip">
        <span className="citation-tooltip-title">{citation.title}</span>
        <a
          className="citation-tooltip-link"
          href={citation.url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
        >
          {citation.url}
        </a>
      </span>
    </span>
  );
}

function renderToken(
  token: string,
  citations: Map<string, Citation>,
  key: number,
) {
  const footnote = token.match(/^\[\^(\d+)\]$/);
  if (footnote) {
    const citation = citations.get(footnote[1]);
    if (citation) {
      return <CitationMark key={key} citation={citation} />;
    }
    return null;
  }

  const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (link) {
    return (
      <a
        key={key}
        className="inline-link"
        href={link[2]}
        target="_blank"
        rel="noreferrer"
      >
        {link[1]}
      </a>
    );
  }

  const bold = token.match(/^\*\*([^*]+)\*\*$/);
  if (bold) {
    return <strong key={key}>{bold[1]}</strong>;
  }

  return <span key={key}>{token}</span>;
}

function renderLine(line: string, citations: Map<string, Citation>) {
  const parts = line.split(TOKEN_RE).filter((part) => part !== "");
  return parts.map((part, i) => renderToken(part, citations, i));
}

function renderContent(content: string, citations: Citation[]) {
  const byId = new Map(citations.map((c) => [c.id, c]));
  const paragraphs = content.split(/\n{2,}/);

  return paragraphs.map((paragraph, pIdx) => {
    const lines = paragraph.split("\n");
    return (
      <p key={pIdx} className="assistant-paragraph">
        {lines.map((line, lIdx) => (
          <span key={lIdx} className="assistant-line">
            {lIdx > 0 && <br />}
            {renderLine(line, byId)}
          </span>
        ))}
      </p>
    );
  });
}

export default function AssistantMessage({
  content,
  citations = [],
  loading,
}: AssistantMessageProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const resolvedCitations = useMemo(() => {
    if (citations.length > 0) {
      return citations;
    }
    return extractCitations(content);
  }, [citations, content]);

  if (loading && !content) {
    return <div className="bubble bubble-assistant">...</div>;
  }

  return (
    <div className="assistant-message">
      <div className="bubble bubble-assistant">
        {renderContent(content, resolvedCitations)}

        {resolvedCitations.length > 0 && (
          <div className="sources-panel">
            <button
              type="button"
              className="sources-toggle"
              onClick={() => setSourcesOpen((open) => !open)}
              aria-expanded={sourcesOpen}
            >
              Sources ({resolvedCitations.length})
              <span className={`sources-chevron${sourcesOpen ? " open" : ""}`}>▾</span>
            </button>
            {sourcesOpen && (
              <ul className="sources-list">
                {resolvedCitations.map((citation) => (
                  <li key={citation.id}>
                    <span className="sources-index">[{citation.id}]</span>
                    <div className="sources-item">
                      {citation.title && citation.title !== citation.url ? (
                        <>
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="sources-title"
                          >
                            {citation.title}
                          </a>
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="sources-url"
                          >
                            {citation.url}
                          </a>
                        </>
                      ) : (
                        <a
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer"
                          className="sources-url"
                        >
                          {citation.url}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
