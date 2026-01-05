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
    existing = await db.users.find_one({"email": user_data.email.lower()}, {"_id": 0})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    
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
    
    token = create_access_token(user_id, user_data.email.lower())
    
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
    
    token = create_access_token(user["user_id"], user["email"])
    
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
    
    email = google_data["email"].lower()
    existing_user = await db.users.find_one({"email": email}, {"_id": 0})
    
    if existing_user:
        user_id = existing_user["user_id"]
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
    
    token = create_access_token(user_id, email)
    
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
        
        messages = await db.messages.find(
            {"session_id": request.session_id},
            {"_id": 0}
        ).sort("timestamp", 1).to_list(100)
        
        conversation_context = ""
        current_destination = None
        current_origin = None
        
        logging.info(f"Processing {len(messages)} messages for context extraction")
        for msg in messages[:-1]:
            conversation_context += f"{msg['role']}: {msg['content']}\n"
            
            if msg['role'] == 'assistant':
                try:
                    content = msg['content'].strip()
                    
                    if '```json' in content:
                        json_start = content.find('```json') + 7
                        json_end = content.find('```', json_start)
                        if json_end != -1:
                            json_content = content[json_start:json_end].strip()
                            trip_json = json.loads(json_content)
                            if trip_json.get('to'):
                                current_destination = trip_json['to']
                            if trip_json.get('from'):
                                current_origin = trip_json['from']
                    elif content.startswith('{'):
                        trip_json = json.loads(content)
                        if trip_json.get('to'):
                            current_destination = trip_json['to']
                        if trip_json.get('from'):
                            current_origin = trip_json['from']
                except Exception as e:
                    logging.error(f"Failed to extract trip context: {e}")
        
        logging.info(f"Context extraction result: origin={current_origin}, destination={current_destination}")
        
        today = datetime.now()
        tomorrow = today + timedelta(days=1)
        
        system_prompt = "You are TripMate, a New Zealand travel assistant."
        
        if conversation_context:
            recent_context = '\n'.join(conversation_context.split('\n')[-6:])
            system_prompt = f"{system_prompt}\n\nCONTEXT:\n{recent_context}\n\nRespond to: {request.message}"
        
        # Build OpenAI messages
        openai_messages = [{"role": "system", "content": system_prompt}]
        
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
            
            if '```json' in cleaned_response:
                json_start = cleaned_response.find('```json')
                if json_start != -1:
                    json_content = cleaned_response[json_start + 7:]
                    json_end = json_content.find('```')
                    if json_end != -1:
                        cleaned_response = json_content[:json_end].strip()
            elif '{' in cleaned_response:
                json_start = cleaned_response.find('{')
                json_end = cleaned_response.rfind('}')
                if json_start != -1 and json_end != -1:
                    cleaned_response = cleaned_response[json_start:json_end + 1]
            
            if cleaned_response.startswith('{'):
                trip_data = json.loads(cleaned_response)
        except Exception as e:
            logging.error(f"Failed to parse trip data: {str(e)}")
        
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
        
        email_doc = {
            "id": str(uuid.uuid4()),
            "recipient_email": request.recipient_email,
            "trip_from": trip.get('from'),
            "trip_to": trip.get('to'),
            "status": "queued",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.email_queue.insert_one(email_doc)
        
        logging.info(f"Email queued for {request.recipient_email}")
        
        return {
            "status": "success",
            "message": f"Trip details will be sent to {request.recipient_email}"
        }
    except Exception as e:
        logging.error(f"Email error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")

@api_router.post("/contact")
async def submit_contact(request: ContactRequest):
    """Handle contact form submissions"""
    try:
        trip = request.trip_data or {}
        
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
        
        logging.info(f"Contact form received from {request.name}")
        
        return {
            "status": "success", 
            "message": "Your message has been sent!"
        }
    except Exception as e:
        logging.error(f"Contact form error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

app.include_router(api_router)

# CORS Configuration
allowed_origins = os.environ.get('CORS_ORIGINS', 'http://localhost:3000').split(',')

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[origin.strip() for origin in allowed_origins],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
