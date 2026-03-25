"""
PetStore Pro – Flask Backend
============================
Routes : Store (public/user), Admin, Cart, Auth, Payments (Razorpay), Payment Slip
DB     : SQLite via SQLAlchemy
Auth   : Separate user and admin sessions
Seed   : 150 products across 6 categories
"""

from datetime import datetime
import hashlib
import hmac
import json
import os

from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "supersecretkey123")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///petstore.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

RAZORPAY_KEY_ID     = os.environ.get("RAZORPAY_KEY_ID", "")
RAZORPAY_KEY_SECRET = os.environ.get("RAZORPAY_KEY_SECRET", "")
ADMIN_USERNAME      = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASSWORD      = os.environ.get("ADMIN_PASS", "admin123")
DEFAULT_PRODUCT_IMAGE = "https://placehold.co/600x600/0f172a/e2e8f0?text=PetStore+Product"

db = SQLAlchemy(app)

try:
    import razorpay
    rzp_client = razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))
except Exception:
    rzp_client = None


# ── Models ──────────────────────────────────────────────────────

class User(db.Model):
    id         = db.Column(db.Integer,     primary_key=True)
    username   = db.Column(db.String(80),  unique=True, nullable=False)
    email      = db.Column(db.String(150), unique=True, nullable=False)
    password   = db.Column(db.String(256), nullable=False)
    created    = db.Column(db.DateTime,    default=datetime.utcnow)

    def to_dict(self):
        return dict(id=self.id, username=self.username, email=self.email)


class Product(db.Model):
    id       = db.Column(db.Integer,     primary_key=True)
    name     = db.Column(db.String(150), nullable=False)
    price    = db.Column(db.Float,       nullable=False)
    stock    = db.Column(db.Integer,     default=0)
    image    = db.Column(db.String(400), default=DEFAULT_PRODUCT_IMAGE)
    category = db.Column(db.String(60),  default="General")
    brand    = db.Column(db.String(80),  default="")
    created  = db.Column(db.DateTime,    default=datetime.utcnow)

    def to_dict(self):
        return dict(id=self.id, name=self.name, price=self.price,
                    stock=self.stock, image=self.image,
                    category=self.category, brand=self.brand)


class Order(db.Model):
    id               = db.Column(db.Integer,     primary_key=True)
    razorpay_order   = db.Column(db.String(120), unique=True)
    razorpay_payment = db.Column(db.String(120), nullable=True)
    amount           = db.Column(db.Float,       nullable=False)
    status           = db.Column(db.String(30),  default="created")
    items_json       = db.Column(db.Text,        default="[]")
    customer_name    = db.Column(db.String(100), default="")
    customer_email   = db.Column(db.String(150), default="")
    customer_phone   = db.Column(db.String(20),  default="")
    user_id          = db.Column(db.Integer,     db.ForeignKey("user.id"), nullable=True)
    created          = db.Column(db.DateTime,    default=datetime.utcnow)

    def to_dict(self):
        return dict(id=self.id, order=self.razorpay_order,
                    payment=self.razorpay_payment, amount=self.amount,
                    status=self.status, items=self.items_json,
                    customer_name=self.customer_name,
                    customer_email=self.customer_email,
                    customer_phone=self.customer_phone,
                    created=str(self.created))


# ── Auth helpers ─────────────────────────────────────────────────

def is_admin():
    return session.get("admin") is True

def is_user():
    return session.get("user_id") is not None

def current_user():
    uid = session.get("user_id")
    return User.query.get(uid) if uid else None

def is_razorpay_ready():
    if not rzp_client:
        return False
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        return False
    if RAZORPAY_KEY_ID == "rzp_test_YOUR_KEY" or RAZORPAY_KEY_SECRET == "YOUR_SECRET":
        return False
    return True


# ── Session status API ────────────────────────────────────────────

@app.route("/api/session", methods=["GET"])
def get_session_status():
    u = current_user()
    return jsonify({
        "is_admin": is_admin(),
        "is_user":  is_user(),
        "user": u.to_dict() if u else None,
    })


# ── USER Page Routes ─────────────────────────────────────────────
# These are public-facing. Users must be logged in as a user
# (not as admin) to shop. Admins visit /admin separately.

@app.route("/")
def index():
    if not is_user():
        return redirect(url_for("user_login_page"))
    return render_template("index.html")

@app.route("/cart")
def cart():
    if not is_user():
        return redirect(url_for("user_login_page"))
    return render_template("cart.html", razorpay_key=RAZORPAY_KEY_ID)

@app.route("/login")
def user_login_page():
    if is_user():
        return redirect(url_for("index"))
    if is_admin():
        return redirect(url_for("admin_page"))
    return render_template("user-login.html")

@app.route("/slip/<int:order_id>")
def payment_slip(order_id):
    order = Order.query.get_or_404(order_id)
    # Allow admin or the owning user to view the slip
    if not is_admin() and (not is_user() or order.user_id != session.get("user_id")):
        return redirect(url_for("user_login_page"))
    items = json.loads(order.items_json) if order.items_json else []
    return render_template("slip.html", order=order, items=items)


# ── ADMIN Page Routes ─────────────────────────────────────────────

@app.route("/admin-login")
def admin_login_page():
    if is_admin():
        return redirect(url_for("admin_page"))
    return render_template("admin-login.html")

@app.route("/admin")
def admin_page():
    if not is_admin():
        return redirect(url_for("admin_login_page"))
    return render_template("admin.html")


# ── User Auth API ─────────────────────────────────────────────────

@app.route("/api/user/register", methods=["POST"])
def user_register():
    d = request.get_json()
    username = (d.get("username") or "").strip()
    email    = (d.get("email") or "").strip().lower()
    password = d.get("password") or ""

    if not username or not email or not password:
        return jsonify({"success": False, "error": "All fields are required"}), 400
    if len(password) < 6:
        return jsonify({"success": False, "error": "Password must be at least 6 characters"}), 400
    if User.query.filter_by(username=username).first():
        return jsonify({"success": False, "error": "Username already taken"}), 409
    if User.query.filter_by(email=email).first():
        return jsonify({"success": False, "error": "Email already registered"}), 409

    user = User(username=username, email=email,
                password=generate_password_hash(password))
    db.session.add(user)
    db.session.commit()
    session["user_id"] = user.id
    return jsonify({"success": True, "user": user.to_dict()}), 201


@app.route("/api/user/login", methods=["POST"])
def user_login():
    d = request.get_json()
    identifier = (d.get("identifier") or "").strip()  # username or email
    password   = d.get("password") or ""

    user = (User.query.filter_by(username=identifier).first() or
            User.query.filter_by(email=identifier.lower()).first())

    if not user or not check_password_hash(user.password, password):
        return jsonify({"success": False, "error": "Invalid username/email or password"}), 401

    session["user_id"] = user.id
    session.pop("admin", None)   # clear any stale admin session
    return jsonify({"success": True, "user": user.to_dict()})


@app.route("/api/user/logout", methods=["POST"])
def user_logout():
    session.pop("user_id", None)
    return jsonify({"success": True})


# ── Admin Auth API ────────────────────────────────────────────────

@app.route("/api/login", methods=["POST"])
def login():
    d = request.get_json()
    if d.get("username") == ADMIN_USERNAME and d.get("password") == ADMIN_PASSWORD:
        session["admin"] = True
        session.pop("user_id", None)  # clear any stale user session
        return jsonify({"success": True})
    return jsonify({"success": False, "error": "Invalid credentials"}), 401

@app.route("/api/logout", methods=["POST"])
def logout():
    session.pop("admin", None)
    session.pop("user_id", None)
    return jsonify({"success": True})


# ── Product API ──────────────────────────────────────────────────
# GET is public (any logged-in user can browse)
# POST/PUT/DELETE require admin

@app.route("/api/products", methods=["GET"])
def get_products():
    if not is_user() and not is_admin():
        return jsonify({"error": "Unauthorized"}), 403
    cat = request.args.get("category", "")
    q   = Product.query.filter_by(category=cat) if cat else Product.query
    return jsonify([p.to_dict() for p in q.all()])

@app.route("/api/products", methods=["POST"])
def add_product():
    if not is_admin(): return jsonify({"error": "Unauthorized"}), 403
    d = request.get_json()
    p = Product(name=d["name"], price=float(d["price"]),
                stock=int(d.get("stock", 0)),
                image=d.get("image", DEFAULT_PRODUCT_IMAGE),
                category=d.get("category", "General"),
                brand=d.get("brand", ""))
    db.session.add(p); db.session.commit()
    return jsonify(p.to_dict()), 201

@app.route("/api/products/<int:pid>", methods=["PUT"])
def update_product(pid):
    if not is_admin(): return jsonify({"error": "Unauthorized"}), 403
    p = Product.query.get_or_404(pid); d = request.get_json()
    p.name=d.get("name",p.name); p.price=float(d.get("price",p.price))
    p.stock=int(d.get("stock",p.stock)); p.image=d.get("image",p.image)
    p.category=d.get("category",p.category); p.brand=d.get("brand",p.brand)
    db.session.commit(); return jsonify(p.to_dict())

@app.route("/api/products/<int:pid>", methods=["DELETE"])
def delete_product(pid):
    if not is_admin(): return jsonify({"error": "Unauthorized"}), 403
    db.session.delete(Product.query.get_or_404(pid)); db.session.commit()
    return jsonify({"success": True})


# ── Payment API ──────────────────────────────────────────────────

@app.route("/api/payment/create-order", methods=["POST"])
def create_order():
    if not is_user():
        return jsonify({"success": False, "error": "Please log in to place an order"}), 403
    if not is_razorpay_ready():
        return jsonify({
            "success": False,
            "error": "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET."
        }), 503

    data   = request.get_json()
    amount = int(float(data.get("amount", 0)) * 100)
    try:
        r = rzp_client.order.create({"amount": amount, "currency": "INR", "payment_capture": 1})
        rzp_id = r["id"]
    except Exception as e:
        return jsonify({"success": False, "error": f"Razorpay order creation failed: {str(e)}"}), 502

    order = Order(razorpay_order=rzp_id, amount=amount/100, status="created",
                  items_json=json.dumps(data.get("items", [])),
                  customer_name=data.get("name",""),
                  customer_email=data.get("email",""),
                  customer_phone=data.get("phone",""),
                  user_id=session.get("user_id"))
    db.session.add(order); db.session.commit()
    return jsonify({"order_id": rzp_id, "amount": amount,
                    "currency": "INR", "key": RAZORPAY_KEY_ID,
                    "db_order_id": order.id})

@app.route("/api/payment/verify", methods=["POST"])
def verify_payment():
    data       = request.get_json()
    order_id   = data.get("razorpay_order_id","")
    payment_id = data.get("razorpay_payment_id","mock_pay")
    signature  = data.get("razorpay_signature","")
    db_oid     = data.get("db_order_id")
    body       = f"{order_id}|{payment_id}".encode()
    digest     = hmac.new(RAZORPAY_KEY_SECRET.encode(), body, hashlib.sha256).hexdigest()
    valid      = hmac.compare_digest(digest, signature)
    order = Order.query.filter_by(razorpay_order=order_id).first() or (Order.query.get(db_oid) if db_oid else None)
    if valid and order:
        order.razorpay_payment = payment_id; order.status = "paid"
        db.session.commit()
        return jsonify({"success": True, "slip_url": f"/slip/{order.id}"})
    if order: order.status = "failed"; db.session.commit()
    return jsonify({"success": False, "error": "Signature mismatch"}), 400


# ── Orders & Stats ───────────────────────────────────────────────

@app.route("/api/orders", methods=["GET"])
def get_orders():
    if not is_admin(): return jsonify({"error": "Unauthorized"}), 403
    return jsonify([o.to_dict() for o in Order.query.order_by(Order.created.desc()).all()])

@app.route("/api/my-orders", methods=["GET"])
def get_my_orders():
    """Returns orders for the currently logged-in user."""
    if not is_user(): return jsonify({"error": "Unauthorized"}), 403
    uid = session["user_id"]
    orders = Order.query.filter_by(user_id=uid).order_by(Order.created.desc()).all()
    return jsonify([o.to_dict() for o in orders])

@app.route("/api/admin/users", methods=["GET"])
def admin_get_users():
    """Admin-only: list all registered user accounts."""
    if not is_admin(): return jsonify({"error": "Unauthorized"}), 403
    users = User.query.order_by(User.created.desc()).all()
    return jsonify([dict(id=u.id, username=u.username, email=u.email,
                         created=str(u.created)) for u in users])

@app.route("/api/stats", methods=["GET"])
def stats():
    if not is_admin(): return jsonify({"error": "Unauthorized"}), 403
    revenue = db.session.query(db.func.sum(Order.amount)).filter_by(status="paid").scalar() or 0
    return jsonify(products=Product.query.count(),
                   orders=Order.query.filter_by(status="paid").count(),
                   revenue=round(revenue,2),
                   low_stock=Product.query.filter(Product.stock < 5).count(),
                   users=User.query.count())


# ── Seed 150 products ────────────────────────────────────────────

SEED = [
    # Dog Food (25)
    ("Royal Canin Adult Dog 3kg",699,"Dog Food","Royal Canin",50,"3b82f6"),
    ("Pedigree Chicken & Veg 10kg",1299,"Dog Food","Pedigree",30,"3b82f6"),
    ("Drools Focus Puppy 3kg",599,"Dog Food","Drools",50,"3b82f6"),
    ("Farmina N&D Grain Free 2.5kg",1899,"Dog Food","Farmina",20,"3b82f6"),
    ("Orijen Original 2kg",2499,"Dog Food","Orijen",15,"3b82f6"),
    ("Acana Regionals 2kg",2199,"Dog Food","Acana",18,"3b82f6"),
    ("Hill's Science Diet Adult 1.5kg",1599,"Dog Food","Hill's",25,"3b82f6"),
    ("Purina Pro Plan Puppy 3kg",1199,"Dog Food","Purina",35,"3b82f6"),
    ("Me-O Adult Dog Chicken 3kg",649,"Dog Food","Me-O",60,"3b82f6"),
    ("Fidele Adult Small Breed 3kg",799,"Dog Food","Fidele",40,"3b82f6"),
    ("Arden Grange Adult 2kg",1099,"Dog Food","Arden Grange",28,"3b82f6"),
    ("Brit Care Sensitive 3kg",999,"Dog Food","Brit Care",22,"3b82f6"),
    ("Taste of the Wild Sierra 1.8kg",2299,"Dog Food","TOTW",12,"3b82f6"),
    ("Wellness Core Ocean 1.8kg",1799,"Dog Food","Wellness",17,"3b82f6"),
    ("Drools Optimum Adult 3kg",749,"Dog Food","Drools",55,"3b82f6"),
    ("Pedigree Dentastix 7pcs",199,"Dog Food","Pedigree",80,"3b82f6"),
    ("Royal Canin Maxi Adult 4kg",1099,"Dog Food","Royal Canin",32,"3b82f6"),
    ("Purina Beneful Adult 1.4kg",599,"Dog Food","Purina",45,"3b82f6"),
    ("Nutrience Subzero Puppy 2.27kg",2099,"Dog Food","Nutrience",14,"3b82f6"),
    ("Merrick Grain Free 1.8kg",1999,"Dog Food","Merrick",10,"3b82f6"),
    ("Vet's Kitchen Adult 2.5kg",1149,"Dog Food","Vet's Kitchen",23,"3b82f6"),
    ("Canine Creek Adult Dry 4kg",849,"Dog Food","Canine Creek",38,"3b82f6"),
    ("Carnilove Salmon & Potato 1.5kg",1699,"Dog Food","Carnilove",16,"3b82f6"),
    ("Farmina Canned Dog 400g",299,"Dog Food","Farmina",70,"3b82f6"),
    ("Pedigree Wet Food Pouch 80g",49,"Dog Food","Pedigree",120,"3b82f6"),
    # Cat Food (25)
    ("Royal Canin Indoor Adult 2kg",999,"Cat Food","Royal Canin",40,"8b5cf6"),
    ("Whiskas Ocean Fish 1.2kg",499,"Cat Food","Whiskas",60,"8b5cf6"),
    ("Me-O Kitten Tuna 1.2kg",449,"Cat Food","Me-O",55,"8b5cf6"),
    ("Orijen Cat & Kitten 1.8kg",2799,"Cat Food","Orijen",12,"8b5cf6"),
    ("Hill's Science Diet Cat 1.6kg",1499,"Cat Food","Hill's",20,"8b5cf6"),
    ("Purina One Adult Cat 1.5kg",799,"Cat Food","Purina",35,"8b5cf6"),
    ("Farmina N&D Cat Grain Free 1.5kg",1899,"Cat Food","Farmina",18,"8b5cf6"),
    ("Drools Adult Cat Chicken 3kg",649,"Cat Food","Drools",48,"8b5cf6"),
    ("Applaws Dry Cat Chicken 400g",899,"Cat Food","Applaws",30,"8b5cf6"),
    ("Felix Mixed Grill Pouches 12pk",599,"Cat Food","Felix",42,"8b5cf6"),
    ("Whiskas Wet Pouches 12pk",349,"Cat Food","Whiskas",65,"8b5cf6"),
    ("Sheba Fine Flakes 6pk",299,"Cat Food","Sheba",55,"8b5cf6"),
    ("Royal Canin Kitten 2kg",1099,"Cat Food","Royal Canin",28,"8b5cf6"),
    ("Taste of the Wild Rocky Mtn 2kg",2199,"Cat Food","TOTW",14,"8b5cf6"),
    ("Wellness Complete Cat 1.8kg",1699,"Cat Food","Wellness",16,"8b5cf6"),
    ("Nutrience Sub Zero Cat 1.36kg",1899,"Cat Food","Nutrience",11,"8b5cf6"),
    ("Acana Meadowland Cat 1.8kg",2099,"Cat Food","Acana",13,"8b5cf6"),
    ("Canine Creek Cat Adult 3kg",699,"Cat Food","Canine Creek",40,"8b5cf6"),
    ("Vet's Kitchen Cat Mature 1.5kg",1199,"Cat Food","Vet's Kitchen",20,"8b5cf6"),
    ("Carnilove Cat Salmon 1.6kg",1599,"Cat Food","Carnilove",15,"8b5cf6"),
    ("Brit Premium Cat Adult 1.5kg",849,"Cat Food","Brit",27,"8b5cf6"),
    ("Me-O Cat Tuna Pouch 80g",59,"Cat Food","Me-O",100,"8b5cf6"),
    ("Temptations Treats Chicken 85g",199,"Cat Food","Temptations",90,"8b5cf6"),
    ("Dreamies Cat Treat Salmon 60g",149,"Cat Food","Dreamies",85,"8b5cf6"),
    ("Royal Canin Sterilised 2kg",1299,"Cat Food","Royal Canin",22,"8b5cf6"),
    # Medicine (25)
    ("Beaphar Vitamin Drops Dog 50ml",299,"Medicine","Beaphar",35,"ef4444"),
    ("Himalaya Erina EP Shampoo 200ml",199,"Medicine","Himalaya",60,"ef4444"),
    ("Frontline Spot-On Cat 3pk",899,"Medicine","Frontline",25,"ef4444"),
    ("Frontline Plus Dog Large 3pk",1099,"Medicine","Frontline",20,"ef4444"),
    ("NexGard Spectra 3 Tablets Dog",1499,"Medicine","NexGard",15,"ef4444"),
    ("Bravecto Spot-On Cat 1pk",1299,"Medicine","Bravecto",18,"ef4444"),
    ("Tick Twister Removal Tool",199,"Medicine","Generic",50,"ef4444"),
    ("Zymox Enzymatic Ear Solution 60ml",899,"Medicine","Zymox",22,"ef4444"),
    ("Virbac Clinsol Antiseptic 200ml",299,"Medicine","Virbac",40,"ef4444"),
    ("Drools Omega 3&6 Supplement 100ml",349,"Medicine","Drools",38,"ef4444"),
    ("Pet Health Probiotic Powder 50g",449,"Medicine","PetHealth",30,"ef4444"),
    ("Himalaya Dental Sticks Dog 7pk",179,"Medicine","Himalaya",70,"ef4444"),
    ("Beaphar Flea Spray 150ml",499,"Medicine","Beaphar",28,"ef4444"),
    ("Milbemax Allwormer Dog 2 Tabs",599,"Medicine","Milbemax",20,"ef4444"),
    ("Milbemax Allwormer Cat 2 Tabs",549,"Medicine","Milbemax",20,"ef4444"),
    ("Bayer Advocate Spot-On Dog 3pk",1199,"Medicine","Bayer",16,"ef4444"),
    ("Cosequin Joint Supplement 60 Caps",1499,"Medicine","Cosequin",12,"ef4444"),
    ("Zylkene Calming Capsules 75mg 30pk",1299,"Medicine","Zylkene",14,"ef4444"),
    ("Petcam Anti-Inflammatory Tablets",899,"Medicine","Virbac",18,"ef4444"),
    ("Vetnique Dermabliss Spray 200ml",699,"Medicine","Vetnique",25,"ef4444"),
    ("Drools Calcium Supplement 100g",249,"Medicine","Drools",45,"ef4444"),
    ("Himalaya Septicare Spray 100ml",199,"Medicine","Himalaya",50,"ef4444"),
    ("Beaphar Eye Drops 10ml",299,"Medicine","Beaphar",32,"ef4444"),
    ("NutriVet Joint Health Chews 70ct",1099,"Medicine","NutriVet",14,"ef4444"),
    ("Seresto Flea Collar Dog 8M",1899,"Medicine","Seresto",4,"ef4444"),
    # Accessories (35)
    ("Kong Classic Rubber Toy Medium",899,"Accessories","Kong",30,"10b981"),
    ("Petmate Sky Kennel Airline 24in",3999,"Accessories","Petmate",8,"10b981"),
    ("Ruffwear Harness Blue Medium",2999,"Accessories","Ruffwear",12,"10b981"),
    ("Trixie Activity Board Dog",1299,"Accessories","Trixie",20,"10b981"),
    ("Ferplast Carrier Atlas 40",2499,"Accessories","Ferplast",10,"10b981"),
    ("Cat Scratcher Post 60cm",799,"Accessories","Generic",25,"10b981"),
    ("Feliway Diffuser Starter Kit",1999,"Accessories","Feliway",15,"10b981"),
    ("Hartz Grooming Brush Slicker",399,"Accessories","Hartz",40,"10b981"),
    ("Flexi Retractable Leash 5m",999,"Accessories","Flexi",28,"10b981"),
    ("PetFusion Dog Bed Medium",2799,"Accessories","PetFusion",10,"10b981"),
    ("Catit Flower Fountain 3L",1699,"Accessories","Catit",18,"10b981"),
    ("Niteize Spolit LED Collar S",499,"Accessories","Niteize",35,"10b981"),
    ("Lupine Collar 1in Width Red",699,"Accessories","Lupine",30,"10b981"),
    ("PetSafe Easy Walk Harness L",1499,"Accessories","PetSafe",15,"10b981"),
    ("Furminator Short Hair Cat",2199,"Accessories","Furminator",12,"10b981"),
    ("Trixie Tunnel Play Cat 50cm",599,"Accessories","Trixie",22,"10b981"),
    ("IRIS Open-Top Dog Kennel",4999,"Accessories","IRIS",3,"10b981"),
    ("Rogz Reflective Leash 1.8m",699,"Accessories","Rogz",32,"10b981"),
    ("Kurgo Travel Bowl 24oz",799,"Accessories","Kurgo",28,"10b981"),
    ("OurPets IQ Treat Ball Medium",699,"Accessories","OurPets",35,"10b981"),
    ("ZippyPaws Burrow Dog Toy",599,"Accessories","ZippyPaws",40,"10b981"),
    ("Chuckit! Ball Launcher Medium",899,"Accessories","Chuckit",20,"10b981"),
    ("SmartyKat Skitter Critters 3pk",299,"Accessories","SmartyKat",50,"10b981"),
    ("Nina Ottosson Dog Casino Game",1899,"Accessories","Nina Ottosson",8,"10b981"),
    ("Pet Gear Travel Lite Stroller",6999,"Accessories","Pet Gear",3,"10b981"),
    ("Zuke's Mini Training Treats 6oz",499,"Accessories","Zuke's",45,"10b981"),
    ("PetSafe Automatic Ball Launcher",5999,"Accessories","PetSafe",4,"10b981"),
    ("Coolaroo Elevated Pet Bed M",1999,"Accessories","Coolaroo",14,"10b981"),
    ("Jolly Pets Romp-n-Roll 6in",599,"Accessories","Jolly Pets",30,"10b981"),
    ("Guardian Gear Parka Dog Coat L",999,"Accessories","Guardian",18,"10b981"),
    ("SportDog FieldTrainer Remote",8999,"Accessories","SportDog",3,"10b981"),
    ("PetSafe Drinkwell Fountain 1.5L",2299,"Accessories","PetSafe",12,"10b981"),
    ("Bergan Comfort Carrier Small",1899,"Accessories","Bergan",10,"10b981"),
    ("Catit Design Scratcher Catnip",799,"Accessories","Catit",22,"10b981"),
    ("Rad Cat Reflective Harness S",1199,"Accessories","Rad Cat",16,"10b981"),
    # Grooming (20)
    ("Wahl Pet Clipper Arco Kit",3499,"Grooming","Wahl",8,"f59e0b"),
    ("Oster A5 Clipper Spare Blade",1299,"Grooming","Oster",15,"f59e0b"),
    ("Andis EasyClip Pro Pet Kit",2999,"Grooming","Andis",10,"f59e0b"),
    ("Tropiclean Berry Coconut 355ml",599,"Grooming","Tropiclean",30,"f59e0b"),
    ("Bio-Groom Super White Shampoo",699,"Grooming","Bio-Groom",25,"f59e0b"),
    ("Vets Best Waterless Bath 198g",599,"Grooming","Vet's Best",35,"f59e0b"),
    ("Hertzko Slicker Brush",799,"Grooming","Hertzko",28,"f59e0b"),
    ("Safari Dog Ear Cleaner 118ml",399,"Grooming","Safari",40,"f59e0b"),
    ("Burt's Bees Dog Shampoo 473ml",699,"Grooming","Burt's Bees",32,"f59e0b"),
    ("Furminator Deshedding Shampoo",899,"Grooming","Furminator",20,"f59e0b"),
    ("Paws & Pals Electric Nail Grinder",1299,"Grooming","Paws & Pals",18,"f59e0b"),
    ("Four Paws Nail Clippers Medium",299,"Grooming","Four Paws",50,"f59e0b"),
    ("Himalaya Pet Wellness Shampoo",199,"Grooming","Himalaya",70,"f59e0b"),
    ("Petsmile Dog Toothbrush Kit",599,"Grooming","Petsmile",25,"f59e0b"),
    ("John Paul Pet Oatmeal Shampoo",799,"Grooming","John Paul",22,"f59e0b"),
    ("Cowboy Magic Detangler Spray",899,"Grooming","Cowboy Magic",18,"f59e0b"),
    ("Chris Christensen Ice on Ice 236ml",1499,"Grooming","CC",12,"f59e0b"),
    ("Show Tech Ear Powder 45g",399,"Grooming","Show Tech",30,"f59e0b"),
    ("Espree Aloe Vera Shampoo 355ml",599,"Grooming","Espree",28,"f59e0b"),
    ("Beaphar Tooth Gel Dog 100g",349,"Grooming","Beaphar",38,"f59e0b"),
    # Birds & Small Pets (20)
    ("Taiyo Pluss Discovery Parrot Food",499,"Birds & Small","Taiyo",30,"06b6d4"),
    ("Vitapol Budgie Mix 500g",299,"Birds & Small","Vitapol",45,"06b6d4"),
    ("Marukan Rabbit Timothy Hay 500g",399,"Birds & Small","Marukan",38,"06b6d4"),
    ("Oxbow Hamster Pellets 255g",599,"Birds & Small","Oxbow",28,"06b6d4"),
    ("Kaytee Fiesta Hamster 1kg",699,"Birds & Small","Kaytee",25,"06b6d4"),
    ("All Living Things Hamster Cage",2499,"Birds & Small","ALT",10,"06b6d4"),
    ("Savic Bird Feeder Cup Set 4pk",299,"Birds & Small","Savic",40,"06b6d4"),
    ("Ferplast Hamster Ball 18cm",349,"Birds & Small","Ferplast",35,"06b6d4"),
    ("Trixie Parrot Swing",399,"Birds & Small","Trixie",30,"06b6d4"),
    ("ZuPreem FruitBlend Parrot 900g",999,"Birds & Small","ZuPreem",20,"06b6d4"),
    ("Hagen Tropimix Parakeet 900g",849,"Birds & Small","Hagen",22,"06b6d4"),
    ("Oxbow Fresh Meadow Hay 1.13kg",699,"Birds & Small","Oxbow",28,"06b6d4"),
    ("SuperPet Crittertrail One Cage",2999,"Birds & Small","SuperPet",8,"06b6d4"),
    ("Kaytee Clean & Cozy Bedding",799,"Birds & Small","Kaytee",22,"06b6d4"),
    ("Vitakraft Parrot Sticks 3pk",199,"Birds & Small","Vitakraft",60,"06b6d4"),
    ("Hartz Parakeet Seed Mix 907g",499,"Birds & Small","Hartz",30,"06b6d4"),
    ("Nature Zone Bearded Dragon Bites",599,"Birds & Small","Nature Zone",18,"06b6d4"),
    ("Zoo Med Turtle Hatchling Pellets",449,"Birds & Small","Zoo Med",22,"06b6d4"),
    ("Tetra Pond Fish Food 340g",499,"Birds & Small","Tetra",28,"06b6d4"),
    ("API Tropical Fish Food 57g",299,"Birds & Small","API",40,"06b6d4"),
]

def seed():
    if Product.query.count() == 0:
        for row in SEED:
            name, price, cat, brand, stock, col = row
            lbl = name[:14].replace(' ','+')
            img = f"https://placehold.co/600x600/{col}/ffffff?text={lbl}"
            db.session.add(Product(name=name, price=price, stock=stock,
                                   category=cat, brand=brand, image=img))
        db.session.commit()
        print(f"Seeded {len(SEED)} products.")


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        seed()
    app.run(debug=True, port=5000)

