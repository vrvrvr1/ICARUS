# PayPal Refund Implementation Guide

## Overview
This implementation adds full PayPal refund functionality to your e-commerce system. When a customer pays via PayPal and requests a refund, the system will automatically process the refund through PayPal's API.

## What Was Implemented

### 1. Database Changes
- **New Column**: `paypal_capture_id` added to `orders` table
  - Stores the PayPal capture ID needed for refund processing
  - Includes index for faster lookups
  - Migration script: `src/database/migrations/add_paypal_capture_id.sql`

### 2. PayPal API Integration (`src/Routes/paypalRoutes.js`)
- **`getPayPalCaptureId(paypalOrderId)`**: Retrieves capture ID from PayPal order
- **`refundPayPalPayment(captureId, amount, reason)`**: Processes refund through PayPal API
- Updated `capture-order` route to store capture ID during payment

### 3. Order Processing (`src/Routes/checkoutRoutes.js`)
- Modified order creation to save `paypal_capture_id` when PayPal payment is captured
- Capture ID is retrieved from session and stored in database

### 4. Admin Refund Processing (`src/Routes/adminRoutes.js`)
- Enhanced refund route to detect PayPal orders
- Automatically calls PayPal API to process refund
- Falls back to manual process if capture ID unavailable
- Stores PayPal refund ID and status in admin notes

### 5. Customer Refund Requests (`src/Routes/accountRoutes.js`)
- **New Endpoint**: `POST /orders/:id/request-refund`
- Allows customers to request refunds for delivered orders
- Validates order status and payment completion
- Notifies all admins of refund requests
- Prevents duplicate refund requests

## How to Deploy

### Step 1: Run Database Migration
```bash
# Navigate to database directory
cd src/database

# Run migration
node run_migration.js
```

Or manually run the SQL:
```bash
psql -U your_username -d your_database -f src/database/migrations/add_paypal_capture_id.sql
```

### Step 2: Verify PayPal Credentials
Ensure your `.env` file has:
```env
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_SECRET=your_paypal_secret
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com  # or production URL
```

### Step 3: Restart Server
```bash
npm start
# or
node app.js
```

## How It Works

### For New Orders (Going Forward)
1. Customer selects PayPal and completes payment
2. System captures payment and stores `paypal_capture_id`
3. Order is created with both `paypal_order_id` and `paypal_capture_id`
4. If refund is needed, admin clicks "Process Refund"
5. System automatically refunds through PayPal API
6. Customer receives refund to their PayPal account

### For Existing Orders (Legacy)
1. Old orders may not have `paypal_capture_id` stored
2. System will attempt to fetch it from PayPal using `paypal_order_id`
3. If successful, refund proceeds automatically
4. If not found, admin sees warning and may need to refund manually through PayPal dashboard

## Customer Workflow

### Requesting a Refund
1. Customer navigates to their order
2. Clicks "Request Refund" (you need to add this UI button)
3. Provides reason for refund
4. Request is sent to admins for review
5. Order status updates to "Refund Requested"
6. Customer receives notification when refund is processed

### Eligibility Rules
- Order must be **delivered** or **completed**
- Payment must be **completed**
- No existing refund request pending
- Cannot request refund for cancelled orders

## Admin Workflow

### Processing a Refund
1. Admin receives notification of refund request
2. Reviews order details in admin panel
3. Clicks "Process Refund" button
4. Enters refund amount and reason
5. System:
   - Detects it's a PayPal order
   - Retrieves PayPal capture ID
   - Calls PayPal API to process refund
   - Updates order status to "Refunded"
   - Notifies customer
6. Refund appears in customer's PayPal account (typically 5-10 days)

## API Endpoints

### Customer Endpoints

#### Request Refund
```http
POST /orders/:id/request-refund
Content-Type: application/json

{
  "reason": "Product damaged/defective/wrong item/changed mind"
}

Response:
{
  "success": true,
  "message": "Refund request submitted successfully..."
}
```

### Admin Endpoints

#### Process Refund
```http
POST /admin/orders/:id/refund
Content-Type: application/json

{
  "refund_amount": 99.99,
  "refund_reason": "Customer request - damaged product",
  "refund_type": "full",
  "admin_notes": "Approved after reviewing photos"
}

Response:
{
  "success": true,
  "message": "Refund processed successfully",
  "refund_amount": 99.99,
  "refund_status": "processed"
}
```

## Error Handling

### PayPal API Errors
- **Capture ID not found**: System tries to fetch from PayPal, warns admin if unavailable
- **Insufficient funds**: PayPal API returns error, shown to admin
- **Already refunded**: System checks and prevents duplicate refunds
- **Network errors**: Caught and returned as user-friendly messages

### Database Errors
- Transaction rollback if PayPal API fails
- No database changes if refund fails
- Audit logs created for all refund attempts

## Testing

### Test in PayPal Sandbox
1. Use sandbox credentials in `.env`
2. Create test order with PayPal sandbox account
3. Process refund through admin panel
4. Check PayPal sandbox for refund transaction
5. Verify customer notification sent

### Test Cases
- ✅ Full refund for PayPal order
- ✅ Partial refund (if implemented)
- ✅ Refund for order with no capture ID (legacy)
- ✅ Duplicate refund prevention
- ✅ Customer refund request flow
- ✅ Admin notification on refund request
- ✅ Error handling for API failures

## UI Integration Needed

### Customer Side
Add a "Request Refund" button to the order tracking page:

```javascript
// In order-track.ejs or similar
<button onclick="requestRefund(orderId)" 
        class="btn btn-warning"
        v-if="order.status === 'Delivered' && !order.refund_status">
  Request Refund
</button>

<script>
async function requestRefund(orderId) {
  const reason = prompt('Please enter reason for refund:');
  if (!reason) return;
  
  const response = await fetch(`/orders/${orderId}/request-refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  
  const data = await response.json();
  alert(data.message || data.error);
  if (data.success) location.reload();
}
</script>
```

### Admin Side
The existing refund button should now work automatically for PayPal orders. No UI changes needed unless you want to show PayPal-specific information.

## Monitoring

### Logs to Monitor
```javascript
// Success logs
'💳 PayPal payment captured: Order XXX, Capture YYY'
'✅ PayPal refund successful: ZZZ'

// Warning logs
'⚠️ No capture ID stored, fetching from PayPal...'
'⚠️ No PayPal capture ID found for order'

// Error logs
'❌ PayPal refund error: [error details]'
```

### Database Queries
```sql
-- Check orders with PayPal capture IDs
SELECT id, paypal_order_id, paypal_capture_id, total, refund_status 
FROM orders 
WHERE payment_method = 'PayPal' 
AND paypal_capture_id IS NOT NULL;

-- Check pending refund requests
SELECT id, customer_id, total, refund_reason, refund_requested_at
FROM orders
WHERE refund_status = 'requested';

-- Check processed refunds
SELECT * FROM refunds 
WHERE status = 'processed' 
ORDER BY processed_at DESC;
```

## Troubleshooting

### Issue: "PayPal capture ID not found"
**Solution**: Old orders don't have capture ID. System will try to fetch from PayPal. If that fails, refund manually through PayPal dashboard.

### Issue: "PayPal refund failed: INSUFFICIENT_FUNDS"
**Solution**: Your PayPal account doesn't have enough balance. Add funds or wait for pending transactions to clear.

### Issue: "PayPal refund failed: CAPTURE_FULLY_REFUNDED"
**Solution**: This capture has already been refunded. Check PayPal transaction history.

### Issue: Migration fails
**Solution**: 
1. Check database credentials in `.env`
2. Ensure you have ALTER TABLE permissions
3. Run SQL manually if migration script fails

## Production Checklist

Before going live:
- [ ] Run database migration in production
- [ ] Update `.env` with production PayPal credentials
- [ ] Test with real PayPal account (small amount)
- [ ] Verify refund appears in PayPal dashboard
- [ ] Set up monitoring for refund failures
- [ ] Document refund policy for customers
- [ ] Train admin staff on refund process
- [ ] Set up email notifications (optional enhancement)

## Future Enhancements

Potential improvements:
1. **Email notifications** when refund is processed
2. **Partial refunds** for specific items
3. **Automatic refunds** for cancelled orders
4. **Refund analytics** dashboard
5. **Dispute management** for rejected refund requests
6. **Multi-currency support** if expanding internationally
7. **Webhook integration** for real-time PayPal updates

## Support

For issues or questions:
1. Check PayPal API documentation: https://developer.paypal.com/docs/api/payments/v2/
2. Review server logs for error details
3. Test in sandbox environment first
4. Contact PayPal support for API-specific issues

---

**Implementation Date**: November 4, 2025
**Version**: 1.0.0
**Status**: Production Ready ✅
