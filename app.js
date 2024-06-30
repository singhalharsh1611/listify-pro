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

const app = express();

app.use(express.static("public"));
app.set('view engine', 'ejs');

app.use(bodyParser.urlencoded({
    extended:true
}));

app.use(session({
    secret: "My untold secret",
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

mongoose.connect("mongodb://localhost:27017/listifyPro");

const userSchema = new mongoose.Schema({
    name:String,
    email:String,
    password:String,
    googleId:String,
    lists:{
        type: Map,
        of: [String]
    }
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
    callbackURL: "http://localhost:3000/auth/google/listify-pro",
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
    res.render("login");
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



app.post("/register", function(req, res) {
    const name = req.body.name;
    const username = req.body.username;
    const password = req.body.password;

    User.register({ username: username, name: name }, password, function(err, user) {
        if (err) {
            console.log(err);
            res.redirect("/register");
        } else {
            passport.authenticate("local")(req, res, function() {
                res.redirect("/showLists");
            });
        }
    });
});

app.post("/home", function(req, res){
    const user = new User({
        username: req.body.username,
        password: req.body.password
      });
    
      req.login(user, function(err){
        if (err) {
          console.log(err);
        } else {
          passport.authenticate("local")(req, res, function(){
            res.redirect("/showLists");
            
          });
        }
      });
});


app.post("/addList", async (req, res) => {
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