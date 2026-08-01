import { Search, X } from "lucide-react";

export function SearchBox({
  value,
  onChange,
  onSearch,
}: {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
}) {
  return (
    <form
      className="search-box"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(value);
      }}
    >
      <Search size={18} />
      <input
        aria-label="Search"
        placeholder="Search or paste a post URL"
        value={value}
        onInput={(event) => onChange(event.currentTarget.value)}
      />
      {value && (
        <button type="button" className="search-box-clear" onClick={() => onChange("")} aria-label="Clear search box" title="Clear search">
          <X size={16} />
        </button>
      )}
    </form>
  );
}
