// Promo bar carousel effect
const promoTexts = [
    "Spend $125, Get a Free Hiking Pack!",
    "Free Delivery on Orders Over $50",
    "30-Day Return Policy on All Items",
    "Join Our Fitness Community Today"
];

let promoIndex = 0;
const promoContent = document.querySelector('.promo-content span:nth-child(2)');

setInterval(() => {
    promoIndex = (promoIndex + 1) % promoTexts.length;
    promoContent.textContent = promoTexts[promoIndex];
}, 4000);