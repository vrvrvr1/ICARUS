// --------------------------
// Step Navigation
// --------------------------
function nextStep(step) {
  document.querySelectorAll('.checkout-section').forEach(sec => sec.style.display = "none");
  document.getElementById(`step-${step}`).style.display = "block";

  document.querySelectorAll('.step').forEach((el, i) => {
    el.classList.toggle("active", i < step);
  });

  if (step === 3) {
    const shipping = `${document.getElementById("firstName").value} ${document.getElementById("lastName").value}, 
${document.getElementById("address").value}, ${document.getElementById("city").value}, 
${document.getElementById("province").value}, ${document.getElementById("zip").value}, 
${document.getElementById("phone").value}, ${document.getElementById("email").value}`;
    document.getElementById("reviewShipping").innerText = shipping;

    const payment = document.querySelector("input[name='payment']:checked")?.value || "Not selected";
    document.getElementById("reviewPayment").innerText = payment;
  }

  if (step === 4) {
    ["FirstName","LastName","Address","City","Province","Zip","Phone","Email"].forEach(id => {
      document.getElementById(`hidden${id}`).value = document.getElementById(id.charAt(0).toLowerCase() + id.slice(1)).value;
    });
    const paymentSelected = document.querySelector("input[name='payment']:checked");
    document.getElementById("hiddenPayment").value = paymentSelected ? paymentSelected.value : "";
  }
}

// --------------------------
// Toggle Card Fields
// --------------------------
const paymentRadios = document.getElementsByName("payment");
const cardDetails = document.getElementById("cardDetails");

paymentRadios.forEach(radio => {
  radio.addEventListener("change", () => {
    cardDetails.style.display = (radio.value === "Card") ? "block" : "none";
  });
});

// --------------------------
// Place Order via AJAX
// --------------------------
async function placeOrder() {
  const selectedPayment = document.querySelector("input[name='payment']:checked")?.value;
  if (!selectedPayment) { alert("Please select a payment method."); return; }

  const data = {
    firstName: document.getElementById("hiddenFirstName").value,
    lastName: document.getElementById("hiddenLastName").value,
    address: document.getElementById("hiddenAddress").value,
    city: document.getElementById("hiddenCity").value,
    province: document.getElementById("hiddenProvince").value,
    zip: document.getElementById("hiddenZip").value,
    phone: document.getElementById("hiddenPhone").value,
    email: document.getElementById("hiddenEmail").value,
    payment_method: selectedPayment
  };

  try {
    const res = await fetch("/checkout/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (result.success) {
      alert("✅ Order completed successfully!");
      window.location.href = `/checkout/confirmation/${result.orderId}`;
    } else {
      alert("❌ " + result.error);
    }
  } catch (err) {
    console.error(err);
    alert("Server error. Please try again.");
  }
}

// --------------------------
// Handle Continue Button (Payment Review)
// --------------------------
async function handleContinue() {
  let selectedPayment;
  paymentRadios.forEach(r => { if (r.checked) selectedPayment = r.value; });
  if (!selectedPayment) { alert("Please select a payment method."); return; }

  if (selectedPayment === "PayPal") {
    try {
      const res = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin"
      });
      const data = await res.json();

      if (!data.approveUrl || !data.orderID) {
        console.error("Invalid PayPal response:", data);
        alert("Failed to create PayPal order.");
        return;
      }

      const paypalWindow = window.open(data.approveUrl, "_blank", "width=500,height=700");
      if (!paypalWindow) { alert("Popup blocked. Please allow popups."); return; }

      const interval = setInterval(async () => {
        if (paypalWindow.closed) {
          clearInterval(interval);

          try {
            const statusRes = await fetch(`/api/paypal/check-status?orderID=${data.orderID}`);
            const statusData = await statusRes.json();

            if (statusData.paid) {
              // Success modal shows, but cart is NOT cleared
              const successModal = new bootstrap.Modal(document.getElementById('successModal'));
              successModal.show();

              document.getElementById("continueBtn").addEventListener("click", () => {
                successModal.hide();
                nextStep(3);
              });
            } else {
              alert("❌ Payment not completed. Please try again.");
            }
          } catch (err) {
            console.error(err);
            alert("Error checking payment status. Please try again.");
          }
        }
      }, 1000);

    } catch (err) {
      console.error(err);
      alert("Failed to redirect to PayPal. Please try again.");
    }
  } else {
    nextStep(3); // COD or Card
  }
}

// --------------------------
// Success Modal Continue
// --------------------------
document.getElementById("continueBtn").addEventListener("click", () => {
  const modalEl = document.getElementById('successModal');
  const modal = bootstrap.Modal.getInstance(modalEl);
  if (modal) modal.hide();
  nextStep(3);
});

// --------------------------
// Intercept Place Order Form
// --------------------------
document.getElementById("placeOrderForm").addEventListener("submit", async e => {
  e.preventDefault();
  await placeOrder();
});
