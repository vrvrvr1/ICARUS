// Prevent multiple executions
if (!window.searchInitialized) {
  window.searchInitialized = true;

  const searchInput = document.getElementById("searchInput");
  const searchResults = document.getElementById("searchResults");

  if (!searchInput || !searchResults) {
    console.warn("Search elements not found");
  } else {
    // Listen for Enter key press to show all search results
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const q = searchInput.value.trim();
        
        if (q.length >= 2) {
          // Redirect to products page with search query
          window.location.href = `/products?search=${encodeURIComponent(q)}`;
        }
      }
    });

    // Listen for typing
    searchInput.addEventListener("input", async () => {
      const q = searchInput.value.trim();
      searchResults.innerHTML = "";

      if (q.length < 2) return; // wait for at least 2 characters

      try {
        const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
        const products = await res.json();

        if (products.length === 0) {
          searchResults.innerHTML = `<li class="list-group-item">No results found</li>`;
          return;
        }

        // Clear results again to be safe
        searchResults.innerHTML = "";

        // Use a Set to track IDs we've already added (extra safeguard)
        const addedIds = new Set();

        products.forEach(p => {
          // Skip if we've already added this product
          if (addedIds.has(p.id)) {
            console.warn(`Duplicate product detected: ${p.id} - ${p.name}`);
            return;
          }
          addedIds.add(p.id);

          const li = document.createElement("li");
          li.className = "list-group-item d-flex align-items-center";
          li.style.cursor = "pointer";
          li.innerHTML = `
            <img src="${p.image_url}" alt="${p.name}" style="width:40px;height:40px;object-fit:cover;margin-right:10px;">
            <div>
              <strong>${p.name}</strong><br>
              <small>$${p.price}</small>
            </div>
          `;

          // 👉 Clicking result redirects to product page
          li.addEventListener("click", () => {
            window.location.href = `/products/${p.id}`;
          });

          searchResults.appendChild(li);
        });
      } catch (err) {
        console.error("❌ Search fetch error:", err);
      }
    });
  }
}
