require("dotenv").config();

// dependencies
const express = require("express");
var app = express();
var sessions = require("client-sessions");
var fs = require("fs");
var bodyParser = require("body-parser");
var exphbs = require("express-handlebars");

// custom modules
const mailService = require("./modules/emailService.js");
const userService = require("./modules/userService.js");
const productService = require("./modules/productService.js");

const hbHelpers = require("./modules/hbHelpers.js");

// express middlewares & setup

// Sets the express view engine to use handlebars (file endings in .hbs), registers helpers
app.engine(
	".hbs",
	exphbs({
		extname: ".hbs",
		helpers: {
			activeLink: hbHelpers.activeLink
		}
	})
);

app.set("view engine", ".hbs");

// creates a static server on the "public directory" (kinda like an apache server)
app.use(express.static("public"));

// sets up the session cookie for authorization
app.use(
	sessions({
		cookieName: "auth",
		secret: process.env.SESSION_SECRET,
		duration: 1 * 1 * 60 * 1000, // HH * MM * SS * MS | fill with ones to the left
		activeDuration: 1 * 60 * 60 * 1000
	})
);

// these two statements allow us to take data from a POST and use it (its available via req.body)
app.use(bodyParser.json());

app.use(bodyParser.urlencoded({ extended: true }));

//console.logs any unhandled rejections (mainly for unhandled promises)
process.on("unhandledRejection", error => {
	// Will print "unhandledRejection err is not defined"
	console.log("unhandledRejection", error);
});

// protecting the /dashboard route (and subroutes) only be available if logged in
app.use("/dashboard", (req, res, next) => {
	if (req.auth.isLoggedIn) {
		next();
	} else {
		res.status(403).send("403 Unauthorized <a href='/'>home</a>");
	}
});

// allows us to reuse the header.html wherever we need it
var standardHeader;
try {
	standardHeader = fs.readFileSync("./common/header.html", "utf8");
} catch (error) {
	console.error("\n\tMissing header file\n");
}

// ROUTES
// 		->	GET 	Place all GET routes here

app.get("/home", (req, res) => {
	res.render("home", { layout: "NavBar", header: standardHeader, pagename: "home" });
	//res.render("home"); //Change to this when HBS is implemented
});

app.get("/forgot", (req, res) => {
	res.sendFile("public/views/ForgottenPassword.html", { root: __dirname });
});
app.get("/verify_email/:email/:token", (req, res) => {
	let token = req.params.token;
	let email = req.params.email;

	userService
		.validateToken(token, email)
		.then(() => {
			res.redirect("../../views/EmailVerified.html");
		})
		.catch(error => {
			res.json(error);
		});
});

app.get("/about_me", (req, res) => {
	if (req.auth.isLoggedIn) {
		res.json(req.auth);
	} else {
		res.sendStatus(403);
	}
});

// Dashboard routes

app.get("/dashboard", (req, res) => {
	res.render("overview", { layout: "dashboard", header: standardHeader, pagename: "overview" });
});

app.get("/dashboard/:route", (req, res) => {
	const route = req.params.route;

	res.render(
		route,
		{
			layout: "dashboard",
			header: standardHeader,
			pagename: route
		},
		(error, html) => {
			if (error) {
				res.redirect("/404");
			} else {
				res.send(html);
			}
		}
	);
});


app.get("/logout", (req, res) => {
	req.auth.isLoggedIn = false;
	req.auth.userDetails = {};
	res.send("logged out <script>setTimeout(()=>{window.location = '/'}, 2000)</script>");
});

// ROUTES
// 		->	POST 	Place all POST routes here

app.post("/signup", (req, res) => {
	userService
		.create({ email: req.body.email, password: req.body.inputPassword })
		.then(() => {
			mailService
				.sendVerificationEmail(req.body.email, "signup")
				.then(() => {
					res.json({ error: false, redirectUrl: "/views/EmailVerificationSent.html" });
					//res.send("signup success, redirecting <script>setTimeout(()=>{window.location = '/'}, 2000)</script>");
				})
				.catch(e => {
					res.json({ error: "Error sending verification email. Please try again later." });

					userService.delete(req.body.email).catch(err => {
						console.log(err);
					});
					if (e.toString().indexOf("Greeting") >= 0) {
						console.log(e + "\n\n\n ***CHECK YOUR FIREWALL FOR PORT 587***");
					}
				});
		})
		.catch(error => {
			switch (error.code) {
				case 11000:
					res.json({ error: "Email already exists. Please login or check your email address for accuracy." });
					break;

				default:
					res.json({ error: "Unspecified error occurred. Please try again later." });
					break;
			}
		});
});

app.post("/resetPassword", function(req, res) {
	const email = req.body.email;

	userService.findMatchingEmail(email).then(function(user) {
		if (user) {
			mailService
				.sendVerificationEmail(req.body.email, "reset")
				.then(() => {
					res.json({ error: false, redirectUrl: "/views/EmailResetSent.html" });
					//res.send("signup success, redirecting <script>setTimeout(()=>{window.location = '/'}, 2000)</script>");
				})
				.catch(e => {
					console.log(e);
					res.redirect("*");

					if (e.toString().indexOf("Greeting") >= 0) {
						console.log(e + "\n\n\n ***CHECK YOUR FIREWALL FOR PORT 587***");
					}
				});
			//res.send("No User...<script>alert('user Email does not exist'); window.location = 'forgot'</script>");
		} else {
			res.json({ error: "User not found in our database.", redirectUrl: "forgot" });
		}
	});
});

app.post("/login", (req, res) => {
	userService
		.authenticate(req.body.email, req.body.password)
		.then(user => {
			req.auth.isLoggedIn = true;
			req.auth.userDetails = user;
			res.json({ error: false, redirectUrl: "/dashboard" });
		})
		.catch(err => {
			res.json({ error: err });
		});
});

app.post("/addProduct", (req, res) => {
	productService.addProduct().then(()=>{
		res.json({error:false, redirectUrl: "/dashboard/products"});
	}).catch(err => {
		res.json({ error: err });
	});
});

// Express MiddleWares

// fallback for unknown routes
app.get("*", (req, res) => {
	res.status(404);
	res.sendFile("public/views/ErrorPage.html", { root: __dirname });
});

if (process.env.ENABLE_SSL) {
	try {
		var httpsOptions = {
			key: fs.readFileSync(__dirname + "/cert/prj666-2021.key"),
			cert: fs.readFileSync(__dirname + "/cert/prj666-2021.crt"),
			ca: [fs.readFileSync(__dirname + "/cert/RapidSSL_RSA_CA_2018.crt")]
		};
		var srv = require("https")
			.createServer(httpsOptions, app)
			.listen(443);
		console.log("https server listening on port 443");
	} catch (error) {
		console.error(error + "\n\n****\tWARNING: SSL IS NOT CONFIGURED\t****");
	}
}

// start listening
app.listen(process.env.SERVER_PORT || 8080, process.env.SERVER_HOSTNAME, () => {
	console.log("http server listening on port " + process.env.SERVER_PORT || 8080);
});
