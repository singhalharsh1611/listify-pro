require('dotenv').config();
const express = require("express");
const bodyParser = require("body-parser");
const ejs = require("ejs");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const saltRounds = 10;
const session = require("express-session");
const passport = require("passport");
const passportLocalMongoose = require("passport-local-mongoose");
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require("mongoose-findorcreate");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const path = require('path');
const app = express();
const MongoStore = require('connect-mongo');

console.log(`Callback URL: ${process.env.CALLBACK_URL}`);


app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(bodyParser.urlencoded({
    extended:true
}));

app.use(session({
  secret: "My untold secret",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URL })
}));

app.use(passport.initialize());
app.use(passport.session());

const connectionString = process.env.MONGODB_URL;
mongoose.connect(process.env.MONGODB_URL)
    .then(() => {
        console.log("Connected to MongoDB");
    })
    .catch(err => {
        console.error("Failed to connect to MongoDB", err);
    });

const userSchema = new mongoose.Schema({
    name:String,
    email:String,
    password:String,
    googleId:String,
    lists:{
        type: Map,
        of: [String]
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationToken: String,
    verificationTokenExpires: Date
});

userSchema.plugin(passportLocalMongoose);
userSchema.plugin(findOrCreate);

const User = new mongoose.model("User", userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function(user, done) {
    done(null, user.id);
});

passport.deserializeUser(async function(id, done) {
    try {
        const user = await User.findById(id).exec();
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

passport.use(new GoogleStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
  },
  function(accessToken, refreshToken, profile, cb) {
    // console.log(profile);

    const firstName = profile.name.givenName || profile.displayName.split(' ')[0];

    User.findOrCreate({ googleId: profile.id }, { name: firstName, googleId: profile.id }, function (err, user) {
      return cb(err, user);
    });
  }
));

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL, 
      pass: process.env.EMAIL_PASSWORD 
    }
  });

  module.exports = transporter;


app.get("/auth/google",
    passport.authenticate('google', { scope: ["profile"] })
);
  
app.get("/auth/google/listify-pro",
    passport.authenticate('google', { failureRedirect: "/login" }),
    function(req, res) {
      // Successful authentication, redirect to secrets.
      res.redirect("/showLists");
});


app.get("/", function(req, res){
    res.render("login");
});

app.get("/login", function(req, res){
    const errorMessage = req.query.error || null;
    res.render("login", { errorMessage: errorMessage});
});

app.get("/register", function(req, res){
    res.render("register");
});

app.get("/showLists", async (req, res) => {
    if (req.isAuthenticated()) {
        try {
            const foundUser = await User.findById(req.user.id).exec();
            
            // now we conver lists to a plain object if it is a Map
            const lists = foundUser.lists ? Array.from(foundUser.lists.keys()) : [];
            
            res.render("showLists", { name: req.user.name, lists: lists });
        } catch (err) {
            console.log(err);
            res.redirect("/login");
        }
    } else {
        res.redirect("/login");
    }
});

app.get("/listTitle/:listName", async function(req, res) {
    const listName = req.params.listName;

    if (req.isAuthenticated()) {
        try {
            const foundUser = await User.findById(req.user.id).exec();
            const listItems = foundUser.lists.get(listName) || [];
            res.render("listTitle", { name: req.user.name, listName: listName, listItems: listItems });
        } catch (err) {
            console.log(err);
            res.redirect("/showLists");
        }
    } else {
        res.redirect("/login");
    }
});

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      res.redirect('/');
    });
  });

app.get("/verification", (req, res)=>{
  res.render("verification");
});

// app.post("/register", function(req, res) {
//     const name = req.body.name;
//     const username = req.body.username;
//     const password = req.body.password;
//         User.register({ username: username, name: name }, password, function(err, user) {
//         if (err) {
//             console.log(err);
//             res.redirect("/register");
//         } else {
//             passport.authenticate("local")(req, res, function() {
//                 res.redirect("/showLists");
//             });
//         }
//     });
// });

app.post("/register", async (req, res) => {
    const name = req.body.name;
    const username = req.body.username;
    const password = req.body.password;
    const token = crypto.randomBytes(32).toString("hex");
  
    try {
      const user = new User({
        username: username,
        name: name,
        verificationToken: token,
        verificationTokenExpires: Date.now() + 3600000 // 1 hour
      });
  
      User.register(user, password, async (err, user) => {
        if (err) {
          console.log(err);
          res.redirect("/register");
        } else {
          const verificationLink = `http://${req.headers.host}/verify-email?token=${token}`;
          const mailOptions = {
            from: process.env.EMAIL,
            to: username,
            subject: 'Email Verification',
            text: `Please click the following link to verify your email: ${verificationLink}`
          };
  
          transporter.sendMail(mailOptions, (err, info) => {
            if (err) {
              console.log(err);
              res.redirect("/register");
            } else {
              console.log("Email sent: " + info.response);
            //   res.send("A verification email has been sent to your email address. Please verify your email to complete registration.");
            res.redirect('/verification');
            }
          });
        }
      });
    } catch (err) {
      console.log(err);
      res.redirect("/register");
    }
  });

  app.get("/verify-email", async (req, res) => {
    const { token } = req.query;
  
    try {
      const user = await User.findOne({
        verificationToken: token,
        verificationTokenExpires: { $gt: Date.now() }
      });
  
      if (!user) {
        res.send("Verification link is invalid or has expired.");
      } else {
        user.isVerified = true;
        user.verificationToken = undefined;
        user.verificationTokenExpires = undefined;
        await user.save();
        res.redirect("/login");
      }
    } catch (err) {
      console.log(err);
      res.redirect("/register");
    }
  });

  app.post("/home", passport.authenticate("local", { failureRedirect: "/login?error=Invalid credentials, Please try again" }), async (req, res) => {
    try {
      const foundUser = await User.findById(req.user.id).exec();
      if (!foundUser.isVerified) {
        res.redirect("/login?error=Please verify your email to log in.");
      } else {
        res.redirect("/showLists");
      }
    } catch (err) {
      console.log(err);
      res.redirect("/login?error=Something went wrong");
    }
  });
  


  app.post("/addList", async (req, res) => {
    if (req.isAuthenticated()) {
        const newList = req.body.newList;

        try {
            const currentUser = await User.findById(req.user.id).exec();
            
            // Initialize lists if not present
            if (!currentUser.lists) {
                currentUser.lists = new Map();
            }

            // Add new list if it doesn't exist
            if (!currentUser.lists.has(newList)) {
                currentUser.lists.set(newList, []);
                await currentUser.save();
            }

            res.redirect("/showLists");
        } catch (err) {
            console.log(err);
            res.redirect("/showLists");
        }
    } else {
        res.redirect("/login");
    }
});



app.post("/removeList", async (req, res) => {
    const listToRemove = req.body.listToRemove;

    try {
        const currentUser = await User.findById(req.user.id).exec();
        if (currentUser.lists.has(listToRemove)) {
            currentUser.lists.delete(listToRemove);
            await currentUser.save();
        }
        res.redirect("/showLists");
    } catch (err) {
        console.log(err);
        res.redirect("/showLists");
    }
});






app.post("/addItem", async (req, res) => {
    const listName = req.body.listName;
    const newItem = req.body.newItem;

    try {
        const foundUser = await User.findById(req.user.id).exec();
        if (foundUser.lists.has(listName)) {
            foundUser.lists.get(listName).push(newItem);
            await foundUser.save();
        }
        res.redirect(`/listTitle/${listName}`);
    } catch (err) {
        console.log(err);
        res.redirect(`/listTitle/${listName}`);
    }
});

app.post("/removeItem", async (req, res) => {
    const listName = req.body.listName;
    const itemToRemove = req.body.itemToRemove;

    try {
        const foundUser = await User.findById(req.user.id).exec();
        if (foundUser.lists.has(listName)) {
            const updatedItems = foundUser.lists.get(listName).filter(item => item !== itemToRemove);
            foundUser.lists.set(listName, updatedItems);
            await foundUser.save();
        }
        res.redirect(`/listTitle/${listName}`);
    } catch (err) {
        console.log(err);
        res.redirect(`/listTitle/${listName}`);
    }
});


app.listen(3000, function(){
    console.log("server at 3000");
})

module.exports = app;
