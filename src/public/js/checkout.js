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
    // make sure review shows the latest values
    syncHiddenFromVisible();
    const fn = document.getElementById("firstName").value;
    const ln = document.getElementById("lastName").value;
    const addr = document.getElementById("address").value;
    const city = document.getElementById("city").value;
    const prov = document.getElementById("province").value;
    const zip = document.getElementById("zip").value;
    const phone = document.getElementById("phone").value;
    const email = document.getElementById("email").value;

    const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val || '—'; };
    setText('rvName', `${fn} ${ln}`.trim());
    setText('rvAddress', addr);
    setText('rvCity', city);
    setText('rvProvince', prov);
    setText('rvZip', zip);
    setText('rvPhone', phone);
    setText('rvEmail', email);

  const paymentCode = document.querySelector("input[name='payment']:checked")?.value || "Not selected";
  const paymentLabelMap = { 'COD': 'Cash on Delivery', 'Card': 'Credit/Debit Card', 'PayPal': 'PayPal' };
  const payment = paymentLabelMap[paymentCode] || paymentCode || 'Not selected';
  setText('reviewPayment', payment);
  }

  if (step === 4) {
    // re-sync before confirmation
    syncHiddenFromVisible();
    ["FirstName","LastName","Address","City","Province","Zip","Phone","Email"].forEach(id => {
      document.getElementById(`hidden${id}`).value = document.getElementById(id.charAt(0).toLowerCase() + id.slice(1)).value;
    });
    const paymentSelected = document.querySelector("input[name='payment']:checked");
    document.getElementById("hiddenPayment").value = paymentSelected ? paymentSelected.value : "";
  }
}

// --------------------------
// Helper: sync hidden fields from visible inputs
// --------------------------
function syncHiddenFromVisible() {
  const map = [
    ['firstName', 'hiddenFirstName'],
    ['lastName', 'hiddenLastName'],
    ['address', 'hiddenAddress'],
    ['city', 'hiddenCity'],
    ['province', 'hiddenProvince'],
    ['zip', 'hiddenZip'],
    ['email', 'hiddenEmail']
  ];
  map.forEach(([srcId, dstId]) => {
    const src = document.getElementById(srcId);
    const dst = document.getElementById(dstId);
    if (src && dst) dst.value = src.value || '';
  });

  // payment method
  const paymentSelected = document.querySelector("input[name='payment']:checked");
  const hiddenPayment = document.getElementById('hiddenPayment');
  if (hiddenPayment) hiddenPayment.value = paymentSelected ? paymentSelected.value : '';

  // ensure an idempotency key exists for this order attempt
  const idem = document.getElementById('idempotencyKey');
  if (idem && !idem.value) {
    // simple UUID v4 generator fallback
    const uuid = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now();
    idem.value = uuid;
  }

  // phone: recompute with country code if available
  const hiddenPhone = document.getElementById('hiddenPhone');
  const select = document.getElementById('countrySelect');
  const phoneInput = document.getElementById('phone');
  const getDigits = (s) => (s || '').replace(/\D/g, '');
  const getCodeDigits = (cc) => (cc || '').replace('+','');
  if (hiddenPhone) {
    if (select && phoneInput) {
      const cc = select.value || '';
      const rawDigits = getDigits(phoneInput.value);
      const codeDigits = getCodeDigits(cc);
      const localDigits = rawDigits.startsWith(codeDigits) ? rawDigits.slice(codeDigits.length) : rawDigits;
      hiddenPhone.value = cc ? `${cc}${localDigits}` : (phoneInput.value || '');
    } else {
      // fallback
      const src = document.getElementById('phone');
      if (src) hiddenPhone.value = src.value || '';
    }
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
  if (placeOrder._inFlight) return; // guard against double-clicks
  placeOrder._inFlight = true;
  const submitBtn = document.querySelector('#placeOrderForm button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Placing...'; }
  // ensure hidden fields are populated just before submit
  syncHiddenFromVisible();

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

  // Include selectedItems (comma-separated cart ids) when present in the DOM
  const selectedInput = document.querySelector("input[name='selectedItems']");
  if (selectedInput && selectedInput.value) data.selectedItems = selectedInput.value;

  // Include chosen shipping amount for accurate totals server-side
  const shippingHidden = document.getElementById('shippingAmountHidden');
  if (shippingHidden && shippingHidden.value) data.shipping_amount = shippingHidden.value;

  // Include idempotency key
  const idem = document.getElementById('idempotencyKey');
  if (idem && idem.value) data.idempotency_key = idem.value;

  // Include PayPal order id (for PayPal flow)
  const ppHidden = document.getElementById('paypalOrderIdHidden');
  if (ppHidden && ppHidden.value) data.paypal_order_id = ppHidden.value;

  // Include discount code if applied
  const discCode = document.getElementById('discountCodeHidden');
  if (discCode && discCode.value) data.discount_code = discCode.value;

  try {
    console.log('Placing order payload:', data);
    const res = await fetch("/checkout/place-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: 'same-origin',
      body: JSON.stringify(data)
    });
    const result = await res.json();

    if (result.success) {
      // Show success modal and redirect on user action (or after short delay)
      try {
        const modalEl = document.getElementById('orderSuccessModal');
        if (modalEl && window.bootstrap && bootstrap.Modal) {
          const modal = new bootstrap.Modal(modalEl);
          modal.show();
          // Ensure single-use click handler
          const btn = document.getElementById('orderSuccessContinueBtn');
          if (btn) {
            btn.replaceWith(btn.cloneNode(true));
            const fresh = document.getElementById('orderSuccessContinueBtn');
            fresh.addEventListener('click', () => {
              modal.hide();
              window.location.href = `/checkout/confirmation/${result.orderId}`;
            }, { once: true });
          }
          // Fallback auto-redirect after 2.5s if user doesn't click
          setTimeout(() => {
            if (document.body.contains(modalEl)) {
              try { modal.hide(); } catch(_) {}
            }
            window.location.href = `/checkout/confirmation/${result.orderId}`;
          }, 2500);
        } else {
          // Fallback if Bootstrap modal isn't available
          window.location.href = `/checkout/confirmation/${result.orderId}`;
        }
      } catch(_) {
        window.location.href = `/checkout/confirmation/${result.orderId}`;
      }
    } else {
      alert("❌ " + result.error);
    }
  } catch (err) {
    console.error(err);
    alert("Server error. Please try again.");
  } finally {
    placeOrder._inFlight = false;
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Place Order'; }
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
      const btn = document.getElementById('reviewOrderBtn');
      if (btn) { btn.disabled = true; btn.textContent = 'Redirecting…'; }
      // Include selection context so PayPal reflects the same totals
      const payload = {
        selectedItems: document.getElementById('selectedItemsHidden')?.value || undefined,
        shipping_amount: document.getElementById('shippingAmountHidden')?.value || undefined,
        discount_code: document.getElementById('discountCodeHidden')?.value || undefined
      };
      const res = await fetch("/api/paypal/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!data.approveUrl || !data.orderID) {
        console.error("Invalid PayPal response:", data);
        alert("Failed to create PayPal order.");
        return;
      }

        // Store PayPal order id in hidden input for later server reconciliation
        const ppHidden = document.getElementById('paypalOrderIdHidden');
        if (ppHidden) ppHidden.value = data.orderID;

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

              const onContinue = () => {
                successModal.hide();
                  // ensure all hidden fields are up to date before review
                  syncHiddenFromVisible();
                nextStep(3);
              };
              const btn = document.getElementById("continueBtn");
              // ensure only one handler is attached
              if (btn) {
                btn.replaceWith(btn.cloneNode(true));
                const fresh = document.getElementById("continueBtn");
                fresh.addEventListener("click", onContinue, { once: true });
              }
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
    } finally {
      const btn = document.getElementById('reviewOrderBtn');
      if (btn) { btn.disabled = false; btn.textContent = 'Review Order'; }
    }
  } else {
    nextStep(3); // COD or Card
  }
}

// Removed global Success Modal Continue listener to avoid duplicate handlers.

// --------------------------
// Intercept Place Order Form
// --------------------------
document.getElementById("placeOrderForm").addEventListener("submit", async e => {
  e.preventDefault();
  await placeOrder();
});
