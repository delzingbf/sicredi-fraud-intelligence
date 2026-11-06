interface Props {
  tools: string[];
}

/**
 * ToolTrace — ordered list of tools executed during an investigation.
 */
export function ToolTrace({ tools }: Props) {
  if (tools.length === 0) {
    return (
      <section className="tool-trace">
        <h3 className="report-section-title">Tools Executed</h3>
        <p className="report-empty">No tools were executed.</p>
      </section>
    );
  }

  return (
    <section className="tool-trace">
      <h3 className="report-section-title">Tools Executed</h3>
      <ol className="tool-list">
        {tools.map((tool, i) => (
          <li key={i} className="tool-item">
            <span className="tool-index">{i + 1}</span>
            <code className="tool-name">{tool}</code>
          </li>
        ))}
      </ol>
    </section>
  );
}
