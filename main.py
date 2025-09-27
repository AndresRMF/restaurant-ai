# main.py
import os
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel

from config import SYSTEM_PROMPT # Your prompt from config.py

load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("CRITICAL: OPENAI_API_KEY environment variable not set.")

app = FastAPI(title="Voice Assistant Backend")

# --- AI Tool Definitions ---
tools = [
    {
        "type": "function",
        # The "function" wrapper object is removed. name, description, etc. are now top-level.
        "name": "show_product_in_carousel",
        "description": "Displays a specific product image in the center of the user's screen.",
        "parameters": {
            "type": "object",
            "properties": {
                "product_name": {
                    "type": "string",
                    "description": "The exact name of the product to display, e.g., 'Classic Burger'."
                }
            },
            "required": ["product_name"]
        }
    },
    {
        "type": "function",
        "name": "add_items_to_order",
        "description": "Adds one or more items to the customer's order cart.",
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "A list of items to add.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "The exact name of the product."},
                            "quantity": {"type": "integer", "description": "How many of this item to add."}
                        },
                        "required": ["name", "quantity"]
                    }
                }
            },
            "required": ["items"]
        }
    },
    {
        "type": "function",
        "name": "remove_items_from_order",
        "description": "Removes one or more items from the customer's order cart.",
        "parameters": {
            "type": "object",
            "properties": {
                "items": {
                    "type": "array",
                    "description": "A list of items to remove.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "name": {"type": "string", "description": "The exact name of the product."},
                            "quantity": {"type": "integer", "description": "How many of this item to remove."}
                        },
                         "required": ["name", "quantity"]
                    }
                }
            },
            "required": ["items"]
        }
    },
    {
        "type": "function",
        "name": "proceed_to_payment",
        "description": "Switches the user interface to the payment view after the order is confirmed."
    },
    {
        "type": "function",
        "name": "fill_payment_form_field",
        "description": "Fills a specific field in the payment form with the provided value.",
        "parameters": {
            "type": "object",
            "properties": {
                "field_id": {
                    "type": "string",
                    "description": "The HTML ID of the form field to fill, e.g., 'fullName', 'address', 'cardNumber'."
                },
                "field_value": {
                    "type": "string",
                    "description": "The value to fill into the specified field."
                }
            },
            "required": ["field_id", "field_value"]
        }
    },
    {
        "type": "function",
        "name": "place_final_order",
        "description": "Submits the payment form after all details have been confirmed by the user."
    }
]

# Allow requests from your frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5500", "http://127.0.0.1:5500"], # Or wherever you serve your HTML
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SessionResponse(BaseModel):
    client_secret: str

@app.post("/create-session", response_model=SessionResponse)
async def create_session():
    """
    Creates a new OpenAI Realtime session and returns a temporary 
    client_secret for the frontend to use.
    """
    url = "https://api.openai.com/v1/realtime/client_secrets"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    
    # This is the modern GA API payload
    payload = {
        "session": {
            "type": "realtime",
            "model": "gpt-realtime",
            "instructions": SYSTEM_PROMPT,
            "tools": tools,
            "tool_choice": "auto",
            "audio": {"output": {"voice": "alloy"}}
        }
    }

    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            
            # The client_secret is directly in the 'value' field
            client_secret = data.get("value")
            if not client_secret:
                raise HTTPException(status_code=500, detail="Client secret not found in OpenAI response.")

            print("Successfully created session, sending client_secret to frontend.")
            return SessionResponse(client_secret=client_secret)

        except httpx.HTTPStatusError as e:
            print(f"Error calling OpenAI: {e.response.text}")
            raise HTTPException(status_code=e.response.status_code, detail=f"Error from OpenAI: {e.response.text}")
        except Exception as e:
            print(f"An unexpected error occurred: {e}")
            raise HTTPException(status_code=500, detail="An unexpected backend error occurred.")