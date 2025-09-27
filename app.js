
let rtcPeerConnection;
let rtcDataChannel;
let localMediaStream;
let remoteAudioElement;
let userAudioTrack;
let isAudioPaused = false;
let currentOrder = [];
let currentIndex = 0;

window.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const pauseButton = document.getElementById('pauseButton');
    const confirmOrderButton = document.getElementById('confirmOrderButton');
    const paymentForm = document.getElementById('payment-form');

    // --- Event Listeners ---
    startButton.addEventListener('click', handleStartSession);
    stopButton.addEventListener('click', handleStopSession);
    pauseButton.addEventListener('click', toggleAudioInput);
    confirmOrderButton.addEventListener('click', handleConfirmOrder);
    paymentForm.addEventListener('submit', handlePlaceOrder);
});


async function handleStartSession() {
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const pauseButton = document.getElementById('pauseButton');

    startButton.disabled = true;
    stopButton.disabled = false;
    updateStatus('connecting', 'Status: Initializing...');

    try {
        const response = await fetch('http://localhost:8000/create-session', { method: 'POST' });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Backend error: ${error.detail}`);
        }
        const { client_secret } = await response.json();
        
        localMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        await connectToOpenAI(client_secret);
        
        pauseButton.disabled = false;
        isAudioPaused = false;
        pauseButton.textContent = "Pause Audio";

    } catch (error) {
        console.error("Failed to start session:", error);
        updateStatus('failed', `Error: ${error.message}`);
        cleanup();
    }
}

/**
 * Establishes the WebRTC connection with OpenAI.
 */
async function connectToOpenAI(ephemeralKey) {
    rtcPeerConnection = new RTCPeerConnection();

    rtcPeerConnection.onconnectionstatechange = () => {
        const state = rtcPeerConnection.connectionState;
        const capitalizedState = state.charAt(0).toUpperCase() + state.slice(1);
        updateStatus(state, `Status: ${capitalizedState}`);
        if (state === 'failed' || state === 'closed' || state === 'disconnected') {
            cleanup();
        }
    };

    remoteAudioElement = new Audio();
    remoteAudioElement.autoplay = true;

    rtcPeerConnection.ontrack = (event) => {
        console.log("Received remote audio track from OpenAI");
        if (event.streams && event.streams[0]) {
            remoteAudioElement.srcObject = event.streams[0];
        }
    };
    
    userAudioTrack = localMediaStream.getAudioTracks()[0];
    rtcPeerConnection.addTrack(userAudioTrack, localMediaStream);

    rtcDataChannel = rtcPeerConnection.createDataChannel("oai-events");
    rtcDataChannel.onmessage = (event) => {
        const message = JSON.parse(event.data);
        console.log("RAW from OpenAI:", message);

        if (message.type === 'response.output_text.delta' && message.text) {
            console.log('Assistant says:', message.text);
        }
        if (message.type === 'response.output_item.done' && message.item.type === 'function_call') {
            handleToolCall(message.item);
        }
        if (message.type === 'response.done' && message.response.status === 'failed') {
            console.error("--- RESPONSE FAILED ---");
            console.error("Reason:", message.response.status_details);
        }
    };

    const offer = await rtcPeerConnection.createOffer();
    await rtcPeerConnection.setLocalDescription(offer);

    const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST", body: offer.sdp,
        headers: { "Authorization": `Bearer ${ephemeralKey}`, "Content-Type": "application/sdp" },
    });

    if (!sdpResponse.ok) throw new Error(`SDP negotiation failed: ${await sdpResponse.text()}`);

    const answerSdp = await sdpResponse.text();
    await rtcPeerConnection.setRemoteDescription({ type: "answer", sdp: answerSdp });
}

/**
 * Toggles the microphone audio track on and off.
 */
function toggleAudioInput() {
    if (!userAudioTrack) return;
    const pauseButton = document.getElementById('pauseButton');
    isAudioPaused = !isAudioPaused;
    if (isAudioPaused) {
        userAudioTrack.enabled = false;
        pauseButton.textContent = "Resume Audio";
    } else {
        userAudioTrack.enabled = true;
        pauseButton.textContent = "Pause Audio";
    }
}

/**
 * Gracefully ends the session and resets the UI.
 */
function handleStopSession() {
    console.log("Stop button clicked. Ending session.");
    cleanup();
}

/**
 * Cleans up all resources and resets the UI to its initial state.
 */
function cleanup() {
    if (rtcPeerConnection) {
        rtcPeerConnection.close();
        rtcPeerConnection = null;
    }
    if (localMediaStream) {
        localMediaStream.getTracks().forEach(track => track.stop());
        localMediaStream = null;
    }
    if (remoteAudioElement) {
        remoteAudioElement.remove();
        remoteAudioElement = null;
    }
    userAudioTrack = null;

    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const pauseButton = document.getElementById('pauseButton');

    startButton.disabled = false;
    stopButton.disabled = true;
    pauseButton.disabled = true;
    pauseButton.textContent = "Pause Audio";
    updateStatus('disconnected', 'Status: Disconnected');
}


// ===================================================================================
//  UI & HELPER FUNCTIONS
//  These functions control specific parts of the UI like the carousel, order, etc.
// ===================================================================================

const CAROUSEL_MAPPING = [
    'Classic Burger', 'Doble Burger', 'Cheese Burger', 
    'Fries', 'Tostadas', 
    'Cola', 'Manzana Soda'
];

const MENU_ITEMS = {
    'Classic Burger': { name: 'Classic Burger', price: 8.99 },
    'Doble Burger': { name: 'Doble Burger', price: 12.99 },
    'Cheese Burger': { name: 'Cheese Burger', price: 9.99 },
    'Fries': { name: 'Fries', price: 3.49 },
    'Tostadas': { name: 'Tostadas', price: 4.49 },
    'Cola': { name: 'Cola', price: 2.50 },
    'Manzana Soda': { name: 'Manzana Soda', price: 2.50 },
};

/**
 * Updates the status indicator UI.
 */
const updateStatus = (state, message) => {
    const statusDiv = document.getElementById('status');
    statusDiv.className = '';
    statusDiv.classList.add(`status-${state}`);
    statusDiv.innerHTML = `<span class="status-indicator"></span> ${message}`;
};

/**
 * Moves the carousel to the target slide index.
 */
const moveToSlide = (targetIndex) => {
    const carouselTrack = document.querySelector('.carousel-track');
    const carouselItems = Array.from(carouselTrack.children);
    const itemWidth = carouselItems.length > 0 ? carouselItems[0].getBoundingClientRect().width : 0;

    if (targetIndex >= 0 && targetIndex < carouselItems.length) {
        carouselTrack.style.transform = 'translateX(-' + itemWidth * targetIndex + 'px)';
        currentIndex = targetIndex;
    }
};

/**
 * Renders the currentOrder array to the order summary UI.
 */
const updateOrderSummary = () => {
    const orderItemsList = document.getElementById('order-items-list');
    const orderTotalPriceEl = document.getElementById('order-total-price');
    orderItemsList.innerHTML = '';
    if (currentOrder.length === 0) {
        orderItemsList.innerHTML = '<li class="placeholder">Your cart is empty</li>';
    } else {
        currentOrder.forEach(item => {
            const li = document.createElement('li');
            li.innerHTML = `<span class="item-name">${item.name}</span><span class="item-price">$${item.price.toFixed(2)}</span>`;
            orderItemsList.appendChild(li);
        });
    }
    const total = currentOrder.reduce((sum, item) => sum + item.price, 0);
    orderTotalPriceEl.textContent = `$${total.toFixed(2)}`;
};

const addItemToOrder = (itemName) => {
    const item = MENU_ITEMS[itemName];
    if (item) {
        currentOrder.push(item);
        updateOrderSummary();
    }
};

const removeItemFromOrder = (itemName) => {
    const indexToRemove = currentOrder.findLastIndex(item => item.name === itemName);
    if (indexToRemove > -1) {
        currentOrder.splice(indexToRemove, 1);
        updateOrderSummary();
    }
};

/**
 * Switches the view to the payment form.
 */
const showPaymentView = () => {
    document.querySelector('.main-content').classList.add('hidden');
    document.getElementById('payment-view').classList.remove('hidden');
};

/**
 * Switches back to the main order view.
 */
const showOrderView = () => {
    document.getElementById('payment-view').classList.add('hidden');
    document.querySelector('.main-content').classList.remove('hidden');
};

/**
 * Handles the click of the (now hidden) confirm order button.
 */
function handleConfirmOrder() {
    if (currentOrder.length > 0) {
        showPaymentView();
    } else {
        alert("Your order is empty!");
    }
}

/**
 * Handles the submission of the final payment form.
 */
function handlePlaceOrder(event) {
    event.preventDefault();
    const paymentForm = document.getElementById('payment-form');
    const successNotification = document.getElementById('success-notification');
    const formData = new FormData(paymentForm);
    const orderDetails = Object.fromEntries(formData.entries());
    
    orderDetails.orderItems = currentOrder;
    orderDetails.totalPrice = currentOrder.reduce((sum, item) => sum + item.price, 0);

    console.log("--- FINAL ORDER DATA (JSON) ---");
    console.log(JSON.stringify(orderDetails, null, 2));

    paymentForm.reset();
    currentOrder = [];
    updateOrderSummary();

    showOrderView();
    successNotification.classList.remove('hidden');
    setTimeout(() => {
        successNotification.classList.add('hidden');
    }, 4000);
}

/**
 * Processes tool calls from the AI.
 */
const handleToolCall = (toolCall) => {
    let toolResultOutput = { status: "success" };
    try {
        const args = toolCall.arguments ? JSON.parse(toolCall.arguments) : {};
        switch (toolCall.name) {
            case 'proceed_to_payment': showPaymentView(); break;
            case 'fill_payment_form_field':
                const fieldElement = document.getElementById(args.field_id);
                if (fieldElement) fieldElement.value = args.field_value;
                else toolResultOutput = { status: "error", reason: `Field ${args.field_id} not found` };
                break;
            case 'place_final_order':
                const placeOrderButton = document.getElementById('payment-form').querySelector('button[type="submit"]');
                if (placeOrderButton) placeOrderButton.click();
                break;
            case 'show_product_in_carousel':
                const productIndex = CAROUSEL_MAPPING.indexOf(args.product_name);
                if (productIndex > -1) moveToSlide(productIndex);
                else toolResultOutput = { status: "error", reason: "Product not found" };
                break;
            case 'add_items_to_order':
                args.items.forEach(item => { for (let i = 0; i < item.quantity; i++) addItemToOrder(item.name); });
                break;
            case 'remove_items_from_order':
                args.items.forEach(item => { for (let i = 0; i < item.quantity; i++) removeItemFromOrder(item.name); });
                break;
            default: toolResultOutput = { status: "error", reason: "Unknown tool" };
        }
    } catch (error) {
        toolResultOutput = { status: "error", reason: error.message };
    }
    if (rtcDataChannel && rtcDataChannel.readyState === 'open') {
        const toolResponseMessage = { type: "conversation.item.create", item: { type: "tool_output", call_id: toolCall.call_id, output: JSON.stringify(toolResultOutput) } };
        rtcDataChannel.send(JSON.stringify(toolResponseMessage));
        const subsequentResponseEvent = { type: "response.create" };
        rtcDataChannel.send(JSON.stringify(subsequentResponseEvent));
    }
};