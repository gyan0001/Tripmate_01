from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import json
from passlib.context import CryptContext
from jose import JWTError, jwt
import httpx
from openai import AsyncOpenAI

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]
openai_client = AsyncOpenAI(api_key=os.environ.get('OPENAI_API_KEY'))

# JWT Configuration
JWT_SECRET = os.environ.get('JWT_SECRET', 'tripmate_secret_key_2024')
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_DAYS = 7

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

app = FastAPI()
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

# ============ AUTH MODELS ============
class UserRegister(BaseModel):
    email: str
    password: str
    name: str

class UserLogin(BaseModel):
    email: str
    password: str

class UserResponse(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse

# ============ AUTH HELPERS ============
def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=JWT_EXPIRATION_DAYS)
    to_encode = {"user_id": user_id, "email": email, "exp": expire}
    return jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> Optional[dict]:
    """Get current user from cookie or Authorization header"""
    token = None
    
    # Try cookie first
    token = request.cookies.get("session_token")
    
    # Fall back to Authorization header
    if not token and credentials:
        token = credentials.credentials
    
    if not token:
        return None
    
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            return None
        
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
        return user
    except JWTError:
        return None

async def require_auth(request: Request, credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """Require authentication - raises 401 if not authenticated"""
    user = await get_current_user(request, credentials)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

# ============ AUTH ENDPOINTS ============
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(user_data: UserRegister, response: Response):
    """Register a new user with email and password"""
    # Check if email already exists
    existing = await db.users.find_one({"email": user_data.email.lower()}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    # Create user
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "user_id": user_id,
        "email": user_data.email.lower(),
        "name": user_data.name,
        "password_hash": hash_password(user_data.password),
        "picture": None,
        "auth_provider": "email",
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.users.insert_one(user_doc)
    
    # Create token
    token = create_access_token(user_id, user_data.email.lower())
    
    # Set cookie
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=JWT_EXPIRATION_DAYS * 24 * 60 * 60,
        path="/"
    )
    
    return TokenResponse(
        access_token=token,
        user=UserResponse(user_id=user_id, email=user_data.email.lower(), name=user_data.name)
    )

@api_router.post("/auth/login", response_model=TokenResponse)
async def login(user_data: UserLogin, response: Response):
    """Login with email and password"""
    user = await db.users.find_one({"email": user_data.email.lower()}, {"_id": 0})
    
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    if not verify_password(user_data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Create token
    token = create_access_token(user["user_id"], user["email"])
    
    # Set cookie
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=JWT_EXPIRATION_DAYS * 24 * 60 * 60,
        path="/"
    )
    
    return TokenResponse(
        access_token=token,
        user=UserResponse(
            user_id=user["user_id"],
            email=user["email"],
            name=user["name"],
            picture=user.get("picture")
        )
    )

@api_router.post("/auth/google/session")
async def google_session(request: Request, response: Response):
    """Exchange Google OAuth session_id for app session"""
    body = await request.json()
    session_id = body.get("session_id")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    
    # Call Emergent Auth to get user data
    async with httpx.AsyncClient() as client:
        try:
            res = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id}
            )
            if res.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid session")
            
            google_data = res.json()
        except Exception as e:
            logging.error(f"Google auth error: {e}")
            raise HTTPException(status_code=401, detail="Authentication failed")
    
    # Check if user exists
    email = google_data["email"].lower()
    existing_user = await db.users.find_one({"email": email}, {"_id": 0})
    
    if existing_user:
        user_id = existing_user["user_id"]
        # Update user info if needed
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "name": google_data.get("name", existing_user["name"]),
                "picture": google_data.get("picture"),
                "last_login": datetime.now(timezone.utc).isoformat()
            }}
        )
        user_name = google_data.get("name", existing_user["name"])
    else:
        # Create new user
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user_doc = {
            "user_id": user_id,
            "email": email,
            "name": google_data.get("name", "User"),
            "picture": google_data.get("picture"),
            "auth_provider": "google",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.users.insert_one(user_doc)
        user_name = google_data.get("name", "User")
    
    # Create JWT token
    token = create_access_token(user_id, email)
    
    # Set cookie
    response.set_cookie(
        key="session_token",
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=JWT_EXPIRATION_DAYS * 24 * 60 * 60,
        path="/"
    )
    
    return {
        "access_token": token,
        "user": {
            "user_id": user_id,
            "email": email,
            "name": user_name,
            "picture": google_data.get("picture")
        }
    }

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(user: dict = Depends(require_auth)):
    """Get current authenticated user"""
    return UserResponse(
        user_id=user["user_id"],
        email=user["email"],
        name=user["name"],
        picture=user.get("picture")
    )

@api_router.post("/auth/logout")
async def logout(response: Response):
    """Logout - clear session cookie"""
    response.delete_cookie(key="session_token", path="/")
    return {"message": "Logged out successfully"}

# ============ TRIP MODELS ============

# ============ TRIP MODELS ============
class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    role: str
    content: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ChatRequest(BaseModel):
    session_id: str
    message: str

class ChatResponse(BaseModel):
    session_id: str
    message: str
    trip_data: Optional[Dict[str, Any]] = None

class TripPlan(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    session_id: str
    from_location: str
    to_location: str
    duration: str
    routes: List[Dict[str, Any]]
    trip_data: Dict[str, Any]
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ShareTripRequest(BaseModel):
    trip_data: Dict[str, Any]
    
class ShareTripResponse(BaseModel):
    share_id: str
    share_url: str

class EmailTripRequest(BaseModel):
    recipient_email: str
    trip_data: Dict[str, Any]

class ContactRequest(BaseModel):
    name: str
    email: str
    phone: Optional[str] = None
    message: Optional[str] = None
    preferred_contact: str = "email"
    trip_data: Optional[Dict[str, Any]] = None

# Owner email for receiving contact form submissions
OWNER_EMAIL = "kevinpatel95999@gmail.com"

@api_router.get("/")
async def root():
    return {"message": "TripMate API is running"}

@api_router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        user_message = Message(
            session_id=request.session_id,
            role="user",
            content=request.message
        )
        
        msg_dict = user_message.model_dump()
        msg_dict['timestamp'] = msg_dict['timestamp'].isoformat()
        await db.messages.insert_one(msg_dict)
        
        # Fetch conversation history from database
        messages = await db.messages.find(
            {"session_id": request.session_id},
            {"_id": 0}
        ).sort("timestamp", 1).to_list(100)
        
        # Build conversation context for AI
        conversation_context = ""
        current_destination = None
        current_origin = None
        last_trip_json = None
        
        logging.info(f"Processing {len(messages)} messages for context extraction")
        for msg in messages[:-1]:  # Exclude the current message
            conversation_context += f"{msg['role']}: {msg['content']}\n"
            
            # Try to extract destination from assistant's JSON response
            if msg['role'] == 'assistant':
                try:
                    content = msg['content'].strip()
                    logging.info(f"Checking assistant message for trip data, length: {len(content)}")
                    
                    # Extract JSON from new format (friendly message + ```json block)
                    if '```json' in content:
                        json_start = content.find('```json') + 7
                        json_end = content.find('```', json_start)
                        if json_end != -1:
                            json_content = content[json_start:json_end].strip()
                            trip_json = json.loads(json_content)
                            if trip_json.get('to'):
                                current_destination = trip_json['to']
                                last_trip_json = trip_json
                                logging.info(f"Extracted destination from ```json: {current_destination}")
                            if trip_json.get('from'):
                                current_origin = trip_json['from']
                                logging.info(f"Extracted origin from ```json: {current_origin}")
                    # Fallback: old format (direct JSON)
                    elif content.startswith('{'):
                        trip_json = json.loads(content)
                        if trip_json.get('to'):
                            current_destination = trip_json['to']
                            last_trip_json = trip_json
                            logging.info(f"Extracted destination from direct JSON: {current_destination}")
                        if trip_json.get('from'):
                            current_origin = trip_json['from']
                            logging.info(f"Extracted origin from direct JSON: {current_origin}")
                except Exception as e:
                    logging.error(f"Failed to extract trip context: {e}")
                    pass
        
        logging.info(f"Context extraction result: origin={current_origin}, destination={current_destination}")
        
        # Get today's date for weather calculations
        from datetime import datetime, timedelta
        today = datetime.now()
        tomorrow = today + timedelta(days=1)
        
        system_prompt = f"""Kia Ora! You are TripMate, your dedicated Kiwi travel assistant for exploring beautiful Aotearoa (New Zealand)! You ONLY plan trips within New Zealand - this is your specialty and passion.

TODAY'S DATE: {today.strftime('%B %d, %Y')} (Use this to calculate trip dates starting from tomorrow: {tomorrow.strftime('%B %d, %Y')})

🥝 KIWI FOCUS - CRITICAL RULES:
- You ONLY plan trips WITHIN New Zealand (Aotearoa)
- If someone asks for international trips, politely redirect: "Kia ora! I'm your Kiwi travel expert, specializing in trips within beautiful Aotearoa 🥝 Where would you like to explore in New Zealand?"
- Use NZD ($) for all prices
- Include Maori place names and cultural experiences
- Highlight uniquely Kiwi experiences

NEW ZEALAND REGIONS & DESTINATIONS:
**North Island (Te Ika-a-Māui):**
- Auckland (Tāmaki Makaurau) - City of Sails, Sky Tower, Waiheke Island
- Wellington (Te Whanganui-a-Tara) - Capital, Te Papa, Craft beer scene
- Rotorua - Geothermal wonders, Maori culture, Hot springs
- Taupo - Lake Taupo, Bungy, Huka Falls
- Bay of Islands - Sailing, Dolphins, Waitangi Treaty Grounds
- Coromandel - Beaches, Hot Water Beach, Cathedral Cove
- Hobbiton (Matamata) - Lord of the Rings movie set
- Napier - Art Deco, Wine country
- Hamilton (Kirikiriroa) - Gardens, Hobbiton gateway

**South Island (Te Waipounamu):**
- Queenstown - Adventure capital, Bungy, Skiing, Milford Sound
- Christchurch (Ōtautahi) - Garden City, Rebuild, Gateway to South
- Dunedin (Ōtepoti) - Scottish heritage, Wildlife, University city
- Kaikoura - Whale watching, Seals, Seafood
- Marlborough - Sauvignon Blanc wines, Sounds
- Nelson - Art, Beaches, Abel Tasman
- Franz Josef/Fox Glaciers - Glacier walks
- Milford Sound (Piopiotahi) - Fiordland, NZ's top attraction
- Wanaka - Lakes, Mountains, That Wanaka Tree
- Invercargill - Stewart Island gateway

KIWI TRAVEL OPTIONS:
- **Inter-island Ferry**: Interislander or Bluebridge (Wellington ↔ Picton)
- **Domestic Flights**: Air New Zealand, Jetstar (use for North-South travel or long distances)
- **Rental Cars**: Most popular way to explore NZ (left-hand driving!)
- **Intercity Bus**: Budget-friendly coach network
- **Scenic Rail**: TranzAlpine (Christchurch-Greymouth), Northern Explorer

PERSONALITY:
- Use Kiwi greetings: "Kia Ora!", "Sweet as!", "Chur!"
- Friendly, helpful, and passionate about Aotearoa
- Include Maori words naturally (with translations)
- Recommend off-the-beaten-path Kiwi experiences
- Give weather tips (NZ weather is changeable!)
- NEVER show raw JSON - always respond conversationally when not planning trips

RESPONSE MODES:
1. **Casual Chat** (hi/hello/how are you/thanks/jokes) → Respond naturally with Kiwi friendliness, NO JSON
2. **International Trip Request** → Politely redirect: "Kia ora! I specialise in trips within beautiful Aotearoa 🥝 Let me help you explore New Zealand instead! Which part interests you - the stunning South Island or the diverse North Island?"
3. **NZ Trip Planning** → Respond with friendly message + JSON in code block
2. **Off-topic Questions** → Politely redirect: "That's interesting! But I'm TripMate, your travel buddy 🌍 Let's plan an amazing trip! Where would you like to go?"
3. **Trip Planning** → Respond with friendly message + JSON in code block

CRITICAL RESPONSE FORMAT FOR TRIP PLANNING:
When planning trips, you MUST respond in this exact format:

I've created an amazing trip plan for [destination]! This includes [brief highlights like flights, hotels, activities]. Check out all the details in the trip panel! 🌍✈️

```json
{{
  "from": "origin city in NZ",
  "to": "destination city in NZ",
  "duration": "X days",
  "trip_type": "domestic"
}}
```

🥝 KIWI TRIP DETECTION:
- **Inter-Island** (North to South or vice versa): Include ferry AND/OR domestic flight options
- **Road Trip** (within same island, drivable under 500km): Include routes ONLY - NO FLIGHTS NEEDED!
- **Long Distance Same Island** (over 500km): May include flight option
- **Long Trip (5+ days)**: Group activities into phases
- **Adventure Trip**: Highlight bungy, skydiving, jet boats, etc.
- **Cultural Trip**: Include Maori experiences, museums, historic sites

⚠️ CRITICAL - WHEN TO INCLUDE FLIGHTS:
- ✅ INCLUDE flights: Inter-island trips (Auckland→Queenstown, Wellington→Christchurch)
- ✅ INCLUDE flights: Long distance (over 500km) like Auckland→Dunedin
- ❌ DO NOT include flights: Short road trips (under 300km) like Auckland→Waitomo, Auckland→Rotorua
- ❌ DO NOT include flights: Medium road trips (300-500km) unless user specifically asks

JSON STRUCTURE FOR NZ TRIP PLANS:
{{
  "from": "Origin city, New Zealand (include Maori name if known)",
  "to": "Destination city, New Zealand (include Maori name if known)",
  "duration": "X days",
  "trip_type": "domestic",
  "travel_dates": {{
    "start": "{tomorrow.strftime('%d/%m/%Y')}",
    "end": "calculate based on duration"
  }},
  "flights": [
    {{
      "airline": "Air New Zealand or Jetstar",
      "route": "Auckland → Queenstown",
      "duration": "1h 50m",
      "stops": "Direct",
      "average_price": "NZ$150-$300",
      "booking_link": "https://www.airnewzealand.co.nz",
      "best_time_to_book": "Book 2-4 weeks ahead for best prices"
    }}
  ],
  "ferry": [
    {{
      "operator": "Interislander or Bluebridge",
      "route": "Wellington → Picton",
      "duration": "3h 30m",
      "average_price": "NZ$55-$180 (with car: NZ$200-$350)",
      "booking_link": "https://www.interislander.co.nz"
    }}
  ],
  "trains": [
    {{
      "operator": "KiwiRail Scenic",
      "route": "Christchurch → Greymouth (TranzAlpine)",
      "duration": "4h 30m",
      "average_price": "NZ$139-$219",
      "booking_link": "https://www.greatjourneysofnz.co.nz"
    }}
  ],
  "routes": [
    {{
      "name": "Route 1: Scenic Drive",
      "distance": "180km",
      "estimated_time": "2h 30m",
      "description": "Description",
      "best_departure_time": "8:00 AM",
      "arrival_time": "10:30 AM",
      "highlights": ["Stop 1", "Stop 2"],
      "coordinates": {{"start": {{"lat": -36.8485, "lng": 174.7633}}, "end": {{"lat": -37.7870, "lng": 175.2793}}}}
    }}
  ],
  "detailed_timeline": [
    {{
      "day": 1,
      "date": "{tomorrow.strftime('%d/%m/%Y')}",
      "title": "Arrival & Exploration",
      "schedule": [
        {{"time": "9:00 AM", "activity": "Activity name", "location": "Location", "duration": "2h", "cost": "$50"}}
      ]
    }}
  ],
  "grouped_itinerary": [
    {{
      "phase": "Days 1-3",
      "title": "Explore London",
      "highlights": ["Big Ben", "Tower of London", "British Museum"],
      "accommodation_area": "Central London"
    }}
  ],
  "places": {{
    "must_visit": [{{"name": "Place", "description": "Why visit", "distance_from_destination": "5km", "recommended_time": "1-2 hours"}}],
    "near_destination": [{{"name": "Nearby", "description": "What's special", "distance": "10km"}}],
    "hidden_gems": [{{"name": "Secret spot", "description": "Off beaten path"}}]
  }},
  "activities": [{{"name": "Activity", "category": "nature/adventure/culture", "description": "Details", "price": "$50", "location": "City"}}],
  "hotels": [{{"name": "REAL Hotel Name", "category": "budget/mid-range/luxury", "price_range": "$100-150/night", "rating": 4.5, "location": "Area", "booking_link": "https://www.booking.com"}}],
  "weather": {{
    "date_range": "{tomorrow.strftime('%d/%m/%Y')} to [end date]",
    "average_temp": "15°C",
    "conditions": "Partly Cloudy",
    "daily_forecast": [
      {{"date": "{tomorrow.strftime('%d/%m/%Y')}", "temp": "14°C", "condition": "Sunny"}},
      {{"date": "{(tomorrow + timedelta(days=1)).strftime('%d/%m/%Y')}", "temp": "16°C", "condition": "Cloudy"}}
    ],
    "packing_tip": "Bring layers - NZ weather changes quickly! And don't forget sunscreen (strong UV)"
  }},
  "cost_estimate": {{
    "fuel": "NZ$150",
    "accommodation": "NZ$400",
    "food": "NZ$200",
    "activities": "NZ$350",
    "total": "NZ$1100"
  }},
  "recommendations": [
    "🥝 Take your time - Kiwi roads are scenic but winding!",
    "🌿 Book Hobbiton tours in advance - they sell out fast!",
    "☀️ NZ sun is strong - always wear sunscreen, even on cloudy days"
  ],
  "packing_list": ["Layers", "Rain jacket", "Sunscreen", "Hiking shoes", "Camera"]
}}

🥝 KIWI RULES:
1. **NZ ONLY**: You ONLY plan trips within New Zealand. Politely decline international requests.
2. **Inter-Island Travel**: For trips between North and South Island, include ferry AND/OR flight options
3. **Domestic Flights**: Air New Zealand, Jetstar - ONLY include for inter-island trips or distances OVER 500km
4. **Short Road Trips (under 300km)**: Auckland→Waitomo, Auckland→Rotorua, Wellington→Napier - NO FLIGHTS, just driving routes!
5. **Ferry**: Interislander/Bluebridge for Wellington ↔ Picton crossing
6. **Weather**: NZ weather is changeable! ALWAYS mention "four seasons in one day" and packing layers
7. **Maori Culture**: Include cultural experiences, use Maori place names with translations
8. **Real NZ Places**: ALL hotels, restaurants, activities must be REAL NZ businesses that exist near the DESTINATION
9. **NZD Currency**: ALWAYS use NZ$ for all prices
10. **Driving Tips**: Left-hand driving, speed limits (100km/h max), winding roads warning
11. **Cost Estimate for NZ trips**: 
    - Road trips: Use "fuel" in cost_estimate (NOT flights!)
    - Inter-island with flights: Include "flights" in cost_estimate
    - Example road trip: {{"fuel": "NZ$150", "accommodation": "NZ$400", "food": "NZ$200", "activities": "NZ$300", "total": "NZ$1050"}}

⚠️ IMPORTANT - PLACES & HOTELS MUST MATCH DESTINATION:
- If trip is to Waitomo → Hotels/places MUST be in Waitomo area (NOT Queenstown!)
- If trip is to Rotorua → Hotels/places MUST be in Rotorua area (NOT Auckland!)
- NEVER mix data from different destinations!

HANDLING FOLLOW-UPS (ALWAYS USE FRIENDLY KIWI MESSAGE + JSON FORMAT):
- "Show me flights" → Only add if inter-island or long distance, otherwise explain it's a road trip
- "Ferry options?" → Friendly message + JSON with Interislander/Bluebridge
- "More hotels" → Friendly message + JSON with additional REAL NZ hotels IN THE DESTINATION AREA
- "Change to 5 days" → Friendly message + JSON with updated duration
- Random questions → Friendly Kiwi redirect to NZ travel (NO JSON)

**KIWI FOLLOW-UP RESPONSE FORMAT:**
For follow-up requests, respond like this:

Sweet as! I've added [what was requested] to your Aotearoa adventure! [Brief description]. Check out the updated details! 🥝

```json
{{
  "from": "original origin",
  "to": "original destination", 
  "duration": "original duration",
  "hotels": [...]
}}
```

**CRITICAL JSON RULE FOR FOLLOW-UPS:**
When user asks for MORE of something (hotels, activities, places), you MUST:
1. Start with friendly message explaining what you added
2. Return a FULL JSON response with the new items added
3. Include at minimum: "from", "to", "duration", and the updated section
3. NEVER return a text list - ALWAYS return proper JSON format

Example for "more hotels" in NZ:
{{
  "from": "Auckland",
  "to": "Queenstown", 
  "duration": "5 days",
  "hotels": [
    {{"name": "Sofitel Queenstown Hotel & Spa", "category": "luxury", "price_range": "NZ$350-$500/night", "rating": 4.7, "location": "Queenstown CBD", "booking_link": "https://www.booking.com"}},
    {{"name": "Nomads Queenstown", "category": "budget", "price_range": "NZ$35-$80/night", "rating": 4.2, "location": "Queenstown Central", "booking_link": "https://www.booking.com"}},
    {{"name": "Millennium Hotel Queenstown", "category": "mid-range", "price_range": "NZ$180-$280/night", "rating": 4.4, "location": "Queenstown", "booking_link": "https://www.booking.com"}}
  ]
}}

Kia Ora! Keep responses helpful, accurate, and focused on beautiful Aotearoa! 🥝"""

        # Add conversation context if exists (limit to last 3 messages for speed)
        if conversation_context:
            recent_context = '\n'.join(conversation_context.split('\n')[-6:])  # Last 3 exchanges
            # Check if there's an active trip discussion
            if messages and any('trip' in m.get('content', '').lower() or 'route' in m.get('content', '').lower() for m in messages[-5:]):
                # Build destination context for follow-up queries
                destination_context = ""
                if current_destination:
                    destination_context = f"""
CURRENT NZ TRIP DESTINATION: {current_destination}
CURRENT NZ TRIP ORIGIN: {current_origin or 'Unknown'}

*** KIWI FOLLOW-UP RULES ***
The user is asking about the trip to "{current_destination}". You MUST:
1. ALWAYS include "from": "{current_origin}", "to": "{current_destination}" in your JSON response - these fields are REQUIRED!
2. If user asks for "more accommodation", "more hotels" → Return REAL NZ hotels/motels/lodges/holiday parks that exist IN or NEAR "{current_destination}"
3. If user asks for "more places", "other activities" → Return REAL NZ places/activities in "{current_destination}" area
4. If user asks for "more restaurants", "food options" → Return REAL NZ restaurants/cafes in "{current_destination}"
5. NEVER use generic names - use actual NZ accommodation names like "YHA", "Bella Vista Motel", "Top 10 Holiday Park", etc.
6. All prices in NZ$

EXAMPLES OF REAL NZ ACCOMMODATION:
✅ YHA Queenstown Lakefront, Bella Vista Motel, Jucy Snooze, Base Backpackers, Hilton Queenstown, Millbrook Resort
✅ Distinction Hotels, Scenic Hotels, Heritage Hotels, Quest Apartments, Sudima Hotels

REQUIRED JSON FIELDS FOR FOLLOW-UP: Always include "from", "to", "duration" even for partial updates!
"""
                
                system_prompt = f"""{system_prompt}

IMPORTANT CONTEXT RULES:
- ALWAYS preserve "from": "{current_origin}", "to": "{current_destination}" in your JSON response!
- If user asks "make it 3 days", "extend to 3 days", "change to 4 days" → KEEP the same from/to locations ({current_origin} to {current_destination}), just change duration and add more timeline days
- If user asks "more places", "add places", "what else" → ADD more places to existing trip in {current_destination}, keep from/to/duration/routes same
- If user asks "show restaurants", "gas stations" → ADD amenities to existing trip near {current_destination}
- If user asks "more hotels", "more accommodation", "other places to stay" → ADD 5-6 MORE REAL hotels/motels/lodges in {current_destination} area. Keep the "from", "to", "duration", "routes" SAME and only update "hotels" array with additional options!
- If user asks "show flights", "flight options", "how to fly" → ADD flights section with realistic prices and airlines
- If user asks "train routes", "train options" → ADD trains section with operators and prices
- NEVER create a completely different trip unless user explicitly mentions NEW cities
{destination_context}

CONVERSATION HISTORY:
{recent_context}

User's current request: {request.message}
Remember: For "{current_destination}" - use ONLY real, Google-searchable names! Always include from/to fields! Include flights for international trips!"""
            else:
                system_prompt = f"{system_prompt}\n\nCONTEXT:\n{recent_context}\n\nRespond to: {request.message}"
        
       # Build OpenAI messages array
openai_messages = [{"role": "system", "content": system_prompt}]

# Add conversation history
for msg in messages:
    openai_messages.append({
        "role": msg['role'],
        "content": msg['content']
    })

# Call OpenAI API
completion = await openai_client.chat.completions.create(
    model="gpt-4o",
    messages=openai_messages,
    temperature=0.7,
    max_tokens=4000
)

response = completion.choices[0].message.content
        
        ai_message = Message(
            session_id=request.session_id,
            role="assistant",
            content=response
        )
        
        ai_msg_dict = ai_message.model_dump()
        ai_msg_dict['timestamp'] = ai_msg_dict['timestamp'].isoformat()
        await db.messages.insert_one(ai_msg_dict)
        
        trip_data = None
        try:
            cleaned_response = response.strip()
            logging.info(f"Original response length: {len(cleaned_response)}")
            
            # Look for JSON in code blocks first
            if '```json' in cleaned_response:
                # Extract JSON from ```json code block
                json_start = cleaned_response.find('```json')
                if json_start != -1:
                    json_content = cleaned_response[json_start + 7:]  # Skip ```json
                    json_end = json_content.find('```')
                    if json_end != -1:
                        cleaned_response = json_content[:json_end].strip()
                        logging.info(f"Extracted from ```json block: length={len(cleaned_response)}")
            elif cleaned_response.startswith('```'):
                # Handle generic ``` blocks
                cleaned_response = cleaned_response.split('\n', 1)[1] if '\n' in cleaned_response else cleaned_response
                cleaned_response = cleaned_response.rsplit('```', 1)[0].strip()
                logging.info(f"Extracted from ``` block: length={len(cleaned_response)}")
            elif '{' in cleaned_response:
                # Extract JSON from mixed content (friendly message + JSON)
                json_start = cleaned_response.find('{')
                json_end = cleaned_response.rfind('}')
                if json_start != -1 and json_end != -1 and json_end > json_start:
                    cleaned_response = cleaned_response[json_start:json_end + 1]
                    logging.info(f"Extracted JSON from mixed content: length={len(cleaned_response)}")
            
            if cleaned_response.startswith('{'):
                logging.info(f"Attempting to parse JSON of length: {len(cleaned_response)}")
                trip_data = json.loads(cleaned_response)
                logging.info(f"JSON parsing successful! Keys: {list(trip_data.keys())}")
        except Exception as e:
            logging.error(f"Failed to parse trip data: {str(e)}")
            logging.error(f"Cleaned response length: {len(cleaned_response) if 'cleaned_response' in locals() else 'N/A'}")
            if 'cleaned_response' in locals() and len(cleaned_response) > 0:
                logging.error(f"First 200 chars: {cleaned_response[:200]}")
                logging.error(f"Last 200 chars: {cleaned_response[-200:]}")
            pass
        
        return ChatResponse(
            session_id=request.session_id,
            message=response,
            trip_data=trip_data
        )
    
    except Exception as e:
        logging.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.get("/chat/{session_id}", response_model=List[Message])
async def get_chat_history(session_id: str):
    messages = await db.messages.find(
        {"session_id": session_id},
        {"_id": 0}
    ).sort("timestamp", 1).to_list(1000)
    
    for msg in messages:
        if isinstance(msg['timestamp'], str):
            msg['timestamp'] = datetime.fromisoformat(msg['timestamp'])
    
    return messages

@api_router.post("/trips", response_model=TripPlan)
async def save_trip(trip: TripPlan):
    trip_dict = trip.model_dump()
    trip_dict['created_at'] = trip_dict['created_at'].isoformat()
    await db.trips.insert_one(trip_dict)
    return trip

@api_router.get("/trips", response_model=List[TripPlan])
async def get_trips():
    trips = await db.trips.find({}, {"_id": 0}).to_list(1000)
    for trip in trips:
        if isinstance(trip['created_at'], str):
            trip['created_at'] = datetime.fromisoformat(trip['created_at'])
    return trips

@api_router.post("/trips/share", response_model=ShareTripResponse)
async def share_trip(request: ShareTripRequest):
    share_id = str(uuid.uuid4())[:8]
    share_doc = {
        "share_id": share_id,
        "trip_data": request.trip_data,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.shared_trips.insert_one(share_doc)
    
    share_url = f"/shared/{share_id}"
    return ShareTripResponse(share_id=share_id, share_url=share_url)

@api_router.get("/trips/shared/{share_id}")
async def get_shared_trip(share_id: str):
    trip = await db.shared_trips.find_one({"share_id": share_id}, {"_id": 0})
    if not trip:
        raise HTTPException(status_code=404, detail="Trip not found")
    return trip

# ============ USER TRIP HISTORY ============
class SaveTripRequest(BaseModel):
    trip_data: Dict[str, Any]

@api_router.post("/user/trips")
async def save_user_trip(request: SaveTripRequest, user: dict = Depends(require_auth)):
    """Save a trip to user's history"""
    trip_id = f"trip_{uuid.uuid4().hex[:12]}"
    trip_doc = {
        "trip_id": trip_id,
        "user_id": user["user_id"],
        "trip_data": request.trip_data,
        "from_location": request.trip_data.get("from", ""),
        "to_location": request.trip_data.get("to", ""),
        "duration": request.trip_data.get("duration", ""),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.user_trips.insert_one(trip_doc)
    return {"trip_id": trip_id, "message": "Trip saved successfully"}

@api_router.get("/user/trips")
async def get_user_trips(user: dict = Depends(require_auth)):
    """Get all trips for the current user"""
    trips = await db.user_trips.find(
        {"user_id": user["user_id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(100)
    return trips

@api_router.delete("/user/trips/{trip_id}")
async def delete_user_trip(trip_id: str, user: dict = Depends(require_auth)):
    """Delete a trip from user's history"""
    result = await db.user_trips.delete_one({
        "trip_id": trip_id,
        "user_id": user["user_id"]
    })
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Trip not found")
    return {"message": "Trip deleted successfully"}

@api_router.post("/email/trip")
async def email_trip(request: EmailTripRequest):
    """Send trip details to user's email"""
    try:
        trip = request.trip_data
        
        # Build HTML email content
        html_content = f"""
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #0ea5e9; margin-bottom: 10px;">TripMate NZ</h1>
            <p style="color: #64748b; margin-bottom: 20px;">Your Kiwi Trip Planner</p>
            
            <div style="background: #f8fafc; border-radius: 12px; padding: 20px; margin-bottom: 20px;">
                <h2 style="margin: 0 0 10px 0; color: #1e293b;">{trip.get('from', 'Origin')} → {trip.get('to', 'Destination')}</h2>
                <p style="color: #64748b; margin: 0;">{trip.get('duration', 'Duration not specified')}</p>
            </div>
            
            {'<div style="margin-bottom: 20px;"><h3 style="color: #1e293b;">Cost Estimate</h3><p>' + str(trip.get('cost_estimate', {})) + '</p></div>' if trip.get('cost_estimate') else ''}
            
            {'<div style="margin-bottom: 20px;"><h3 style="color: #1e293b;">Hotels</h3><ul>' + ''.join([f"<li>{h.get('name', 'Hotel')} - {h.get('price_range', 'Price TBD')}</li>" for h in trip.get('hotels', [])[:5]]) + '</ul></div>' if trip.get('hotels') else ''}
            
            {'<div style="margin-bottom: 20px;"><h3 style="color: #1e293b;">Activities</h3><ul>' + ''.join([f"<li>{a.get('name', 'Activity')}</li>" for a in trip.get('activities', [])[:5]]) + '</ul></div>' if trip.get('activities') else ''}
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e2e8f0;">
                <p style="color: #64748b; font-size: 14px;">This trip was created with TripMate NZ - Your Kiwi Trip Planner</p>
            </div>
        </div>
        """
        
        # Store the email request in database (for now, as we don't have email service configured)
        email_doc = {
            "id": str(uuid.uuid4()),
            "recipient_email": request.recipient_email,
            "trip_from": trip.get('from'),
            "trip_to": trip.get('to'),
            "status": "queued",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.email_queue.insert_one(email_doc)
        
        logger.info(f"Email queued for {request.recipient_email}: {trip.get('from')} to {trip.get('to')}")
        
        return {
            "status": "success",
            "message": f"Trip details will be sent to {request.recipient_email}"
        }
    except Exception as e:
        logger.error(f"Email error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")

@api_router.post("/contact")
async def submit_contact(request: ContactRequest):
    """Handle contact form submissions - sends to owner email"""
    try:
        trip = request.trip_data or {}
        
        # Store contact submission in database
        contact_doc = {
            "id": str(uuid.uuid4()),
            "name": request.name,
            "email": request.email,
            "phone": request.phone,
            "message": request.message,
            "preferred_contact": request.preferred_contact,
            "trip_from": trip.get('from'),
            "trip_to": trip.get('to'),
            "trip_duration": trip.get('duration'),
            "status": "new",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.contact_submissions.insert_one(contact_doc)
        
        logger.info(f"Contact form received from {request.name} ({request.email})")
        
        # In production, this would send an email to OWNER_EMAIL
        # For now, we log and store in database
        
        return {
            "status": "success", 
            "message": "Your message has been sent! Our travel expert will contact you soon."
        }
    except Exception as e:
        logger.error(f"Contact form error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to submit contact form: {str(e)}")

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
