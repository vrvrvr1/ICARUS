
const searchInput = document.getElementById("searchInput");
const searchResults = document.getElementById("searchResults");

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

    products.forEach(p => {
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

