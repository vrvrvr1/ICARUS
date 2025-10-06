document.addEventListener('DOMContentLoaded', () => {
  // ---------- Elements ----------
  const minRating = document.getElementById("minRating");
  const maxRating = document.getElementById("maxRating");
  const minRatingVal = document.getElementById("minRatingVal");
  const maxRatingVal = document.getElementById("maxRatingVal");
  const ratingTrack = document.getElementById("ratingTrack");

  const minRange = document.getElementById("minPrice");
  const maxRange = document.getElementById("maxPrice");
  const minVal = document.getElementById("minPriceVal");
  const maxVal = document.getElementById("maxPriceVal");
  const priceTrack = document.getElementById("priceTrack");

  const colorSpans = document.querySelectorAll('.colors span');
  const sizeButtons = document.querySelectorAll('.sizes button');
  const applyBtn = document.getElementById('applyFilter');
  // Select the product grid inside the currently active tab; fallback to any .product-grid
  const getProductGrid = () => document.querySelector('.tab-content.active .product-grid') || document.querySelector('.product-grid');

  let selectedColors = [];
  let selectedSizes = [];
  const maxGap = 1; // minimum gap for price slider


  // ---------- Rating Slider ----------
  function updateRatingValues() {
    let min = parseFloat(minRating.value);
    let max = parseFloat(maxRating.value);

    if (min > max) {
      [minRating.value, maxRating.value] = [max, min];
      min = parseFloat(minRating.value);
      max = parseFloat(maxRating.value);
    }

    minRatingVal.textContent = min.toFixed(1);
    maxRatingVal.textContent = max.toFixed(1);

    // Position values above thumbs
    const percent1 = ((min - minRating.min) / (minRating.max - minRating.min)) * 100;
    const percent2 = ((max - maxRating.min) / (maxRating.max - maxRating.min)) * 100;

    minRatingVal.style.left = percent1 + "%";
    maxRatingVal.style.left = percent2 + "%";

    ratingTrack.style.background = `linear-gradient(to right, #ddd ${percent1}%, #f39c12 ${percent1}%, #f39c12 ${percent2}%, #ddd ${percent2}%)`;
  
  }

  minRating.addEventListener("input", updateRatingValues);
  maxRating.addEventListener("input", updateRatingValues);
  updateRatingValues();


  // ---------- Price Slider ----------
  function updateSlider(e) {
    let min = parseInt(minRange.value);
    let max = parseInt(maxRange.value);

    if (max - min <= maxGap) {
      if (e.target.id === "minPrice") {
        minRange.value = max - maxGap;
      } else {
        maxRange.value = min + maxGap;
      }
      min = parseInt(minRange.value);
      max = parseInt(maxRange.value);
    }

    minVal.textContent = "$" + min;
    maxVal.textContent = "$" + max;

    const percent1 = ((min - minRange.min) / (minRange.max - minRange.min)) * 100;
    const percent2 = ((max - maxRange.min) / (maxRange.max - maxRange.min)) * 100;

    priceTrack.style.background = `linear-gradient(to right, #ddd ${percent1}%, #f39c12 ${percent1}%, #f39c12 ${percent2}%, #ddd ${percent2}%)`;
  }

  minRange.addEventListener("input", updateSlider);
  maxRange.addEventListener("input", updateSlider);
  updateSlider({ target: maxRange });


  // ---------- Colors ----------
  colorSpans.forEach(span => {
    span.style.backgroundColor = span.dataset.color;
    span.addEventListener("click", () => {
      const color = span.dataset.color;
      if (selectedColors.includes(color)) {
        selectedColors = selectedColors.filter(c => c !== color);
        span.classList.remove("active");
      } else {
        selectedColors.push(color);
        span.classList.add("active");
      }
    });
  });


  // ---------- Sizes ----------
  sizeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const size = btn.dataset.size;
      if (selectedSizes.includes(size)) {
        selectedSizes = selectedSizes.filter(s => s !== size);
        btn.classList.remove('active');
      } else {
        selectedSizes.push(size);
        btn.classList.add('active');
      }
    });
  });


    // ---------- Apply Filter (AJAX) ----------
// ---------- Apply Filter (AJAX) ----------
if (!applyBtn) return; // nothing to do

applyBtn.addEventListener('click', async () => {
  const query = new URLSearchParams({
    minPrice: minRange.value || 1,
    maxPrice: maxRange.value || 50,
    minRating: minRating.value || 1,
    maxRating: maxRating.value || 5,
    colors: selectedColors.join(','),
    sizes: selectedSizes.join(',')
  });

  try {
    const res = await fetch(`/products/filter?${query.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    const data = await res.json();

    const productGrid = getProductGrid();
    if (!productGrid) {
      console.warn('No product grid found to render filter results into.');
      return;
    }
    productGrid.innerHTML = "";

    if (data.length > 0) {
      data.forEach(p => {
        const colorsHTML = (p.colors || "")
          .split(",")
          .map(c => `<span style="display:inline-block;width:15px;height:15px;margin-right:3px;border:1px solid #ccc;background:${c.trim()}"></span>`)
          .join("");

        productGrid.innerHTML += `
<div class="product-card">
  <a href="/products/${p.id}" class="card-link">
    <!-- Product Image -->
    <img src="${p.image_url}" alt="${p.name}">

    <!-- Price & Name -->
    <div class="product-price">$${p.price}</div>
    <div class="product-name">${p.name}</div>

    <!-- Colors -->
    <div class="colors">
      ${colorsHTML}
    </div>

    <!-- Bottom row (rating inside link) -->
    <div class="bottom-row">
      <div class="rating">
        <i class="bi bi-star-fill" style="color: black;"></i>
        <span class="rating-value">${p.rating}</span>
        <span class="review-count">(${p.reviews})</span>
      </div>
  </a>

      <!-- Wishlist button outside link -->
      <button class="wishlist-btn">
        <i class="bi bi-heart"></i>
      </button>
    </div>
</div>
        `;
      });
    } else {
      productGrid.innerHTML = "<p>No products match your filter.</p>";
    }

  } catch (err) {
    console.error("Filter error:", err);
  }
});

  });