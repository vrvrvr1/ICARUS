# Quick Start: PayPal Refund System

## 🚀 Immediate Next Steps

### 1. Verify Migration (DONE ✅)
```bash
# Already completed successfully!
✅ paypal_capture_id column added to orders table
✅ Index created for performance
```

### 2. Test the System

#### A. For New Orders (Starting Now)
Every new PayPal order will automatically save the capture ID. Test it:

1. **Place a test order:**
   - Use PayPal sandbox credentials
   - Complete the payment
   - Check database:
   ```sql
   SELECT id, paypal_order_id, paypal_capture_id 
   FROM orders 
   ORDER BY order_date DESC LIMIT 1;
   ```
   - You should see the `paypal_capture_id` populated!

2. **Test refund:**
   - Go to admin panel
   - Find the test order
   - Click "Process Refund"
   - System will automatically refund through PayPal
   - Check PayPal sandbox to verify

#### B. For Existing Orders (Legacy)
Old orders don't have capture ID saved, but the system handles this:

1. System will try to fetch capture ID from PayPal using `paypal_order_id`
2. If successful, refund proceeds automatically
3. If not found, admin sees warning to refund manually

### 3. Add Customer UI (Optional)

Add a "Request Refund" button to your order tracking page:

```html
<!-- In src/views/customer/order-track.ejs or similar -->
<% if (order.status?.toLowerCase().includes('deliver') && 
       !order.refund_status && 
       order.payment_completed) { %>
  <button onclick="requestRefund()" class="btn btn-warning">
    Request Refund
  </button>
<% } %>

<script>
async function requestRefund() {
  const reason = prompt('Please enter reason for refund:');
  if (!reason) return;
  
  try {
    const res = await fetch('/orders/<%= order.id %>/request-refund', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    });
    
    const data = await res.json();
    
    if (data.success) {
      alert('✅ ' + data.message);
      location.reload();
    } else {
      alert('❌ ' + data.error);
    }
  } catch (err) {
    alert('❌ Error submitting refund request');
  }
}
</script>
```

### 4. Monitor Refunds

Check server logs for these messages:

```
✅ Success:
"💳 PayPal payment captured: Order XXX, Capture YYY"
"✅ PayPal refund successful: ZZZ"

⚠️ Warnings:
"⚠️ No capture ID stored, fetching from PayPal..."
"⚠️ No PayPal capture ID found for order"

❌ Errors:
"❌ PayPal refund error: [details]"
```

### 5. Production Deployment

When ready to go live:

1. **Update .env with production credentials:**
   ```env
   PAYPAL_CLIENT_ID=your_production_client_id
   PAYPAL_SECRET=your_production_secret
   PAYPAL_BASE_URL=https://api-m.paypal.com
   ```

2. **Restart server:**
   ```bash
   npm start
   ```

3. **Test with small amount:**
   - Place real order ($1-5)
   - Verify capture ID saved
   - Process refund
   - Confirm refund appears in PayPal

## 💡 Common Scenarios

### Scenario 1: Customer Requests Refund
1. Customer clicks "Request Refund" on their order
2. Enters reason (damaged, wrong item, etc.)
3. Admin receives notification
4. Admin reviews and clicks "Process Refund"
5. System automatically refunds via PayPal
6. Customer receives notification

### Scenario 2: Admin Initiates Refund
1. Admin finds order in admin panel
2. Clicks "Process Refund"
3. Enters amount and reason
4. If PayPal order:
   - System calls PayPal API automatically
   - Refund processes instantly
   - Customer notified
5. If not PayPal:
   - Database updated only
   - Admin handles payment separately

### Scenario 3: Partial Refund
Currently system supports full refunds. For partial:
1. Admin enters partial amount
2. System validates amount ≤ total
3. PayPal API processes partial refund
4. Remaining balance stays with merchant

## 🔍 Troubleshooting

### "PayPal capture ID not found"
**Solution:** Old order without saved capture ID. System tries to fetch from PayPal. If fails, manually refund through PayPal dashboard and update order status.

### "PayPal refund failed: INSUFFICIENT_FUNDS"
**Solution:** Add funds to PayPal account or wait for pending transactions.

### "SSL connection required"
**Solution:** Already fixed in code. SSL enabled by default.

### Refund not appearing in customer's PayPal
**Solution:** PayPal refunds take 5-10 business days. Check PayPal dashboard to verify refund was processed.

## 📊 Database Queries

**Check recent refunds:**
```sql
SELECT o.id, o.paypal_order_id, o.paypal_capture_id, 
       o.total, o.refund_amount, o.refund_status,
       o.refund_requested_at, o.refund_processed_at
FROM orders o
WHERE o.refund_status IS NOT NULL
ORDER BY o.order_date DESC
LIMIT 10;
```

**Find orders needing capture ID:**
```sql
SELECT id, paypal_order_id, total
FROM orders
WHERE payment_method = 'PayPal'
  AND paypal_capture_id IS NULL
  AND paypal_order_id IS NOT NULL;
```

**Pending refund requests:**
```sql
SELECT id, customer_id, total, refund_reason, refund_requested_at
FROM orders
WHERE refund_status = 'requested'
ORDER BY refund_requested_at DESC;
```

## 🎯 Success Indicators

You'll know it's working when:
- ✅ New PayPal orders have `paypal_capture_id` populated
- ✅ Admin refunds process without errors
- ✅ PayPal dashboard shows refund transactions
- ✅ Customer notifications sent automatically
- ✅ Server logs show success messages

## 📞 Getting Help

1. **Check logs first** - Most issues show in console
2. **Review PAYPAL_REFUND_GUIDE.md** - Comprehensive documentation
3. **Test in sandbox** - Always test before production
4. **PayPal support** - For API-specific issues

---

## ✅ Current Status

- [x] Code implemented
- [x] Database migrated
- [x] Error handling added
- [x] Logging configured
- [ ] **→ NEXT: Test with PayPal sandbox**

**You're ready to test!** 🎉

Start by placing a test order with PayPal sandbox and verify the capture ID is saved.
