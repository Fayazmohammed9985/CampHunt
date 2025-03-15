if(process.env.NODE_ENV !== "productions"){
    require('dotenv').config();
}
const express=require('express')
const path=require('path')
const app=express()
const mongoose=require('mongoose')
const mongooSanitize=require('express-mongo-sanitize');
const Campground=require('./models/campgrounds')
const Review=require('./models/Review')
const User=require('./models/user')
const methodOverride=require('method-override')
const catchAsyncError=require('./ErrorHandling/AsyncCatch')
const ExpressError=require('./ErrorHandling/ExpressError')
const morgan=require('morgan')
const ejsMate=require('ejs-mate')
const session=require('express-session')
const passport=require('passport')
const localPassport=require('passport-local')
const flash = require('connect-flash');
const {isLoggedin}=require('./middleware')
const { storeReturnTo } = require('./middleware');
const {cloudinary,storage}=require('./cloudinary')
const multer=require('multer')
const upload=multer({storage})
const maptilerClient = require("@maptiler/client");
maptilerClient.config.apiKey = process.env.MAPTILER_API_KEY;
const nodemailer = require('nodemailer');
const crypto = require("crypto");
const otpStore = new Map(); 
// Store OTPs temporarily
const dbUrl=process.env.DB_URL || 'mongodb://localhost:27017/CampHunt';
const MongoStore = require('connect-mongo');
const secret=process.env.SECRET || 'thisisverypersonal'






mongoose.connect(dbUrl,{   //'mongodb://localhost:27017/CampHunt'
    useNewUrlParser:true,
    useUnifiedTopology:true
}).then(()=>{
    console.log('mongodb connected successfully')
}).catch((err)=>{
    console.log('Mongodb connection error',err)
})


const store = MongoStore.create({
    mongoUrl: dbUrl,
    touchAfter: 24 * 60 * 60,
    crypto: {
        secret
    }
});
store.on("error",function(e){
    console.log("session store error",e)
})
const sessionConfig=({
    store,
    name:'session',
    secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,  // Protects against XSS attacks
        secure: false,   // Set to `true` in production if using HTTPS
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week expiration
    }
})
app.use(express.json()); // Required to parse JSON requests

app.use(express.static('public'));
app.engine('ejs',ejsMate)
app.set('view engine','ejs')
app.use(mongooSanitize())
app.set('views',path.join(__dirname,'views'))
app.use(express.urlencoded({extended:true}))
app.use(methodOverride('_method'))
app.use(morgan('dev'))
app.use(session(sessionConfig))
app.use(flash());
app.use(passport.initialize())
app.use(passport.session())
passport.use(new localPassport(User.authenticate()))


passport.serializeUser(User.serializeUser())
passport.deserializeUser(User.deserializeUser())

app.use((req, res, next) => {
    console.log("Middleware - Current User:", req.user);
    next();
});

app.use((req, res, next) => {
    res.locals.currentUser=req.user;
    res.locals.success = req.flash('success') || null;
    res.locals.error = req.flash('error') || null;
    next();
});
const transporter = nodemailer.createTransport({
    service: 'Gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

app.get('/home',(req,res)=>{
    res.render('home')
})

app.post("/send-otp", async (req, res) => {
    const { email } = req.body;

    console.log("Received email for OTP:", email); // Debugging log

    if (!email) {
        return res.status(400).json({ success: false, message: "Email is required" });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    otpStore.set(email, otp);
    

    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email, 
        subject: "Your OTP Code",
        text: `Your OTP code is: ${otp}. It expires in 5 minutes.`,
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`OTP sent to ${email}`);
        res.json({ success: true, message: "OTP sent successfully" });
    } catch (error) {
        console.error("Error sending OTP:", error);
        res.status(500).json({ success: false, message: "Failed to send OTP" });
    }
});

app.post("/verify-otp", (req, res) => {
    const { email, otp } = req.body;

    if (!email || !otp) {
        return res.status(400).json({ success: false, message: "Email and OTP are required" });
    }

    console.log(`Verifying OTP for ${email}: Received OTP - ${otp}, Stored OTP - ${otpStore.get(email)}`); // Debugging log

    if (otpStore.get(email) === otp) {
        otpStore.delete(email); // OTP should be used only once
        res.json({ success: true, message: "OTP verified successfully" });
    } else {
        res.status(400).json({ success: false, message: "Invalid OTP" });
    }
});



app.get('/register', (req, res) => {
    res.render('users/register');
});

app.post('/register', catchAsyncError(async (req, res, next) => {
    try {
        const { email, username, password } = req.body;
        const existingUser = await User.findOne({
            $or: [{ email }, { username }]
        });
        if (existingUser) {
            req.flash('error', 'User already exists! Please log in.');
            return res.redirect('/register');
        }
        const user = new User({ email, username });
        const registeredUser = await User.register(user, password);
        req.login(registeredUser, err => {
            if (err) return next(err);
            req.flash('success', 'Welcome to CampHunt!');
            res.redirect('/campgrounds');
        });
    } catch (e) {
        req.flash('error', e.message);
        res.redirect('/register');
    }
}));



app.get('/login',(req,res)=>{
    res.render('users/login')
})
app.post('/login',storeReturnTo,passport.authenticate('local',{failureFlash:true,failureRedirect:'/login'}),catchAsyncError(async (req,res) => {
   req.flash('success','you are successfully logged in')
   const redirectUrl = res.locals.returnTo || '/campgrounds';
   delete req.session.returnTo;
   console.log(redirectUrl)
   res.redirect(redirectUrl)
    
}))
app.get('/logout', (req, res, next) => {
    req.logout(function (err) {
        if (err) {
            return next(err);
        }
        req.flash('success', 'You have logged out!');
        res.redirect('/home');
    });
}); 
app.get('/campgrounds', async (req, res) => {
    let query = req.query.query;
    let campgrounds;
    
    if (query) {
        // Search by location (city, state, or country)
        campgrounds = await Campground.find({
            location: { $regex: query, $options: 'i' } // Case-insensitive search
        });
    } else {
        campgrounds = await Campground.find({});
    }

    res.render('campgrounds/index', { campgrounds, query });
});

// app.get('/campgrounds',catchAsyncError(async(req,res,next)=>{
//     const campgrounds=await Campground.find({});
//     res.render('campgrounds/index',{campgrounds})
// }))
app.get('/campgrounds/new',isLoggedin,(req,res)=>{
    res.render('campgrounds/new')
})
app.post('/campgrounds', isLoggedin, upload.array('images'), catchAsyncError(async (req, res) => {
    // Fetch geolocation data
    const geoData = await maptilerClient.geocoding.forward(req.body.campground.location, { limit: 1 });

    // console.log("GeoData:", JSON.stringify(geoData, null, 2)); // Full debug log

    if (!geoData.features.length) {
        req.flash('error', 'Invalid location, please try again.');
        return res.redirect('/campgrounds/new');
    }

    // Ensure geometry object exists
    const geometry = geoData.features[0].geometry;
    if (!geometry || !geometry.type || !geometry.coordinates) {
        req.flash('error', 'Geolocation data is missing or incorrect.');
        return res.redirect('/campgrounds/new');
    }

    const campground = new Campground(req.body.campground);

    campground.geometry= {
        type: geometry.type,  // "Point"
        coordinates: geometry.coordinates // [longitude, latitude]
    };

    // Add images
    campground.images = req.files.map(f => ({ url: f.path, filename: f.filename }));
    campground.author = req.user._id;

    // Save to DB
    await campground.save();
    // console.log("Saved Campground:", campground);

    req.flash('success', 'Successfully created campground');
    res.redirect(`/campgrounds/${campground._id}`);
}));


// app.post('/campgrounds',isLoggedin,upload.array('images'),catchAsyncError(async(req,res)=>{
//     const geoData = await maptilerClient.geocoding.forward(req.body.campground.location, { limit: 1 });
//     console.log("GeoData:", geoData);  // Debugging

//     const campground = new Campground(req.body.campground);

//     campground.geometry = geoData.features[0].geometry;

//     campground.images=req.files.map(f=>({url:f.path,filename:f.filename}))
//     campground.author=req.user._id;
//     await campground.save();
//     console.log(campground)
//     req.flash('success','successfully created campground')
//     res.redirect(`/campgrounds/${campground._id}`)   
// }))
app.get('/campgrounds/:id',catchAsyncError(async(req,res)=>{
    const campground=await Campground.findById(req.params.id).populate({
        path: 'reviews',
        populate: { path: 'author' } 
    }).populate('author')
     if (!campground){
        throw new ExpressError('Campground Not Found', 404);
    }
    res.render('campgrounds/show',{campground})  
}))
app.get('/campgrounds/:id/edit',isLoggedin,catchAsyncError(async(req,res)=>{
    const campground=await Campground.findById(req.params.id)
    if (!campground){
        throw new ExpressError('Campground Not Found', 404);
    }
    res.render('campgrounds/edit',{campground})   
}))
app.put('/campgrounds/:id', isLoggedin, upload.array('images'), catchAsyncError(async (req, res) => {
    const { id } = req.params;

    // Fetch updated geolocation data
    const geoData = await maptilerClient.geocoding.forward(req.body.campground.location, { limit: 1 });

    console.log("Updated GeoData:", JSON.stringify(geoData, null, 2)); // Debugging log

    if (!geoData.features.length) {
        req.flash('error', 'Invalid location, please enter a valid address.');
        return res.redirect(`/campgrounds/${id}/edit`);
    }

    // Extract geometry details
    const geometry = geoData.features[0].geometry;

    // Find and update the campground
    const campground = await Campground.findByIdAndUpdate(id, { 
        ...req.body.campground, 
        geometry: {
            type: geometry.type,  
            coordinates: geometry.coordinates 
        }
    });

    // Handle new images
    const imgs = req.files.map(f => ({ url: f.path, filename: f.filename }));
    campground.images.push(...imgs);

    // Handle image deletions
    if (req.body.deleteImages) {
        for (let filename of req.body.deleteImages) {
            await cloudinary.uploader.destroy(filename);
        }
        await campground.updateOne({ $pull: { images: { filename: { $in: req.body.deleteImages } } } });
    }

    // Save and redirect
    await campground.save();
    req.flash('success', 'Successfully updated campground!');
    res.redirect(`/campgrounds/${campground._id}`);
}));

// app.put('/campgrounds/:id',isLoggedin,upload.array('images'),catchAsyncError(async(req,res)=>{
    
//     const {id}=req.params;
//     const campground=await Campground.findByIdAndUpdate(id,{...req.body.campground});
//     const imgs=req.files.map(f=>({url:f.path,filename:f.filename}))
//     campground.images.push(...imgs)
//     if(req.body.deleteImages){
//         for(let filename of req.body.deleteImages){
//             await cloudinary.uploader.destroy(filename);
//         }
//     await campground.updateOne({$pull:{images:{filename:{$in:req.body.deleteImages}}}})
//     }
//     await campground.save();
//     res.redirect(`/campgrounds/${campground._id}`)
// }))
app.delete('/campgrounds/:id',catchAsyncError(async(req,res)=>{
    const{id}=req.params;
    const campground = await Campground.findById(id);
    if (!campground) {
        throw new ExpressError('Campground Not Found', 404);
    }
    await Review.deleteMany({ _id: { $in: campground.reviews } }); 
    await Campground.findByIdAndDelete(id)
    res.redirect('/campgrounds') 
}))
app.get('/campgrounds/:id/reviews', catchAsyncError(async (req, res) => {
    const campground = await Campground.findById(req.params.id);

    if (!campground) {
        req.flash('error', 'Campground not found!');
        return res.redirect('/campgrounds'); // Redirect to main list if not found
    }

    res.redirect(`/campgrounds/${campground._id}`);
}));

app.post('/campgrounds/:id/reviews', isLoggedin, catchAsyncError(async (req, res) => {
    const campground = await Campground.findById(req.params.id);
    if (!campground) {
        req.flash('error', 'Campground not found!');
        return res.redirect('/campgrounds');
    }
    const review = new Review(req.body.review);
    review.author = req.user._id;  
    await review.save();  
    campground.reviews.push(review);  
    await campground.save();  

    req.flash('success', 'Review added successfully!');
    res.redirect(`/campgrounds/${campground._id}`);
}));

app.delete('/campgrounds/:id/reviews/:rid',catchAsyncError(async(req,res)=>{
    const {id,rid}=req.params;
    const campground=await Campground.findById(id);
    if (!campground) {
        throw new ExpressError('Campground Not Found', 404);
    }
    const review = await Review.findById(rid);
    if (!review) {
        throw new ExpressError('Review Not Found', 404);
    }
    await Campground.findByIdAndUpdate(id,{$pull:{reviews:rid}})
    await Review.findByIdAndDelete(rid)

         res.redirect(`/campgrounds/${id}`)
}))
app.all('*',(req,res,next)=>{
    next(new ExpressError('Page Not Found',404))
})
app.use((err,req,res,next)=>{
    const{statusCode=500}=err
if(!err.message) err.message='Something! Went Worng' 
        res.status(statusCode).render('error',{err})
})
app.listen(3000,()=>{
    console.log('serving server on port 3000')
})

