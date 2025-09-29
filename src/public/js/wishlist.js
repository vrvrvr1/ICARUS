document.querySelectorAll(".wishlist-btn").forEach(button => {
  button.addEventListener("click", async function () {
    const productId = this.getAttribute("data-id");

    try {
      const res = await fetch(`/wishlist/toggle/${productId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      const data = await res.json();

      if (data.wishlisted) {
        document.querySelectorAll(`.wishlist-btn[data-id="${productId}"] i`).forEach(icon => {
          icon.classList.remove("bi-heart");
          icon.classList.add("bi-heart-fill");
          icon.style.color = "red"; // optional: make heart red
        });
      } else {
        document.querySelectorAll(`.wishlist-btn[data-id="${productId}"] i`).forEach(icon => {
          icon.classList.remove("bi-heart-fill");
          icon.classList.add("bi-heart");
          icon.style.color = ""; // reset to default
        });
      }
    } catch (err) {
      console.error("❌ Error updating wishlist", err);
    }
  });
});
