import { useState } from "react";

function App() {
  const [query, setQuery] = useState("");

  return (
    <div className="app">
      <header>
        <h1>JSON Store Viewer</h1>
        <p>Read-only frontend for browsing and querying your JSON Store</p>
      </header>

      <main>
        <section className="query-panel">
          <h2>Query Panel</h2>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='{"filter": {"status": {"$eq": "open"}}}'
            rows={6}
          />
          <button onClick={() => console.log("Query:", query)}>Execute Query</button>
        </section>

        <section className="results">
          <h2>Results</h2>
          <p>No results yet. Implementation coming in later stages.</p>
        </section>
      </main>
    </div>
  );
}

export default App;
