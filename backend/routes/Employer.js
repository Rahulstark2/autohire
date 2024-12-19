const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const jwt = require('jsonwebtoken');
const { z } = require('zod'); // Import Zod
const { Employer,JobApplicant,JobPost } = require('../db');
require('dotenv').config();
const passport = require("passport");
const { authMiddleware } = require('../middleware');
const { matchResumesForJob } = require('../services/JobMatch');
const CLIENT_URL = process.env.CLIENT_URL
// Zod Schema for Employer Signup
const employerSignupSchema = z.object({
  fullName: z.string().min(3, 'Name should have at least 3 characters'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password should be at least 6 characters long').optional(), // Optional password
  signUpMethod: z.enum(['manual', 'google']),
  profilePicture: z.string().url('Invalid URL').optional(), // Ensure signupType can only be 'normal' or 'google'
}).refine(
  (data) => data.signUpMethod !== 'manual' || (data.password && data.password.length >= 6),
  {
    message: 'Password is required and should be at least 6 characters long',
    path: ['password'],
  }
);

// Zod Schema for Employer Signin
const employerSigninSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password should be at least 6 characters long'),
});

const jobPostSchema = z.object({
  companyName: z.string().min(5, 'Company name must be at least 5 characters.'),
  companyDescription: z.string().min(100, 'Description must be at least 100 characters.'),
  fullName: z.string().min(3, 'Full name must be at least 3 characters.'),
  position: z.string().min(2, 'Position must be at least 2 characters.'),
  linkedInProfile: z.string().url().refine(
    (value) => /^https?:\/\/(www\.)?linkedin\.com\/.*$/.test(value),
    { message: 'Please enter a valid LinkedIn profile URL.' }
  ),
  email: z.string().email('Please enter a valid email address.'),
  phoneNumber: z.string().regex(/^\d{10,}$/, 'Phone number should only contain digits and have a minimum of 10 digits.'),
  employeeNumber: z.enum(["1-49", "50-199", "200-499", "500+",""]),
  jobRole: z.string().min(5, 'Job Role must be at least 5 characters.'),
  jobDescription: z.string().min(100, 'Job Description must be at least 100 characters.'),
  experience: z.enum(["0-1 years", "2-4 years", "5-7 years", "8+ years"]),
  jobLocation: z.enum(["onsite", "remote"]),
  country: z.string().optional(),
  city: z.string().optional(),
  skills: z.array(z.string().min(2, 'Each skill must be at least 2 characters.')).min(1, 'Please add at least one skill.'),
  minSalary: z.string().regex(/^\d+$/, 'Salary must contain only digits.'),
  maxSalary: z.string().regex(/^\d+$/, 'Salary must contain only digits.')
}).refine((data) => {
  if (data.jobLocation === "onsite") {
    if (!data.country || data.country.length < 5) {
      return false;
    }
    if (!data.city || data.city.length < 3) {
      return false;
    }
  }
  return true;
}, { 
  message: "Country must be at least 5 characters and City at least 3 characters for onsite jobs.",
  path: ["country", "city"]
});


// Signup route for Employer
router.post('/signup', async (req, res) => {
  try {
    
    // Validate request body with Zod
    const { fullName, email, password, signUpMethod } = employerSignupSchema.parse(req.body);
    let existingApplicant = await Employer.findOne({ email });

        // If the user doesn't exist in JobApplicant collection, check in Employer collection
        if (!existingApplicant) {
          existingApplicant = await JobApplicant.findOne({ email });
        }


    
    if (existingApplicant) {
      return res.status(400).json({ message: 'Email already exists' });
    }


    let hashedPassword = null;
    hashedPassword = await bcrypt.hash(password, 10);
    const newApplicant = new Employer({
      fullName,
      email,
      password: hashedPassword, // Use hashedPassword if it's not null, otherwise it will be null
      signUpMethod, // Include signupType when creating a new applicant
    });

    await newApplicant.save();
    res.status(201).json({ message: 'You registered successfully' });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.log(err.errors)
      return res.status(400).json({ message: err.errors.map(e => e.message) });
    }
    console.log(err.message)
    res.status(500).json({ message: 'Error registering applicant', error: err.message });
  }
});

// Signin route for Employer
router.post('/signin', async (req, res) => {
  
  try {
    // Validate request body with Zod
    
    const { email, password } = employerSigninSchema.parse(req.body);

    const applicant = await Employer.findOne({ email });
    
    if (!applicant) {
      
      return res.status(400).json({ message: 'User not found' });
    }

    if(applicant.signUpMethod!=="manual") {
      return res.status(400).json({message: "Please sign in with the method you used to sign up"})
    }

    const isMatch = await bcrypt.compare(password, applicant.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid password. Please check again' });
    }

    
    
    const payload = {
      id: applicant._id,
      email: applicant.email,
      fullName: applicant.fullName,
      role:"employer"
    };

    const token = jwt.sign(payload, process.env.JWT_SECRET);
    
    // Set the JWT token in an HTTP-only, secure cookie
    res.cookie('token', token, {
      httpOnly: true,   // Prevents client-side JavaScript from accessing the cookie
      secure: false,     // Ensures the cookie is sent only over HTTPS (set to false if testing locally over HTTP)
      sameSite: 'Strict'// CSRF protectio // 1 hour
    });
    res.json({ message: 'You signed in successfully'});
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.errors.map(e => e.message) });
    }
    res.status(500).json({ message: 'Error logging in', error: err.message });
  }
});

router.post('/jobpost', authMiddleware, async (req, res) => {
  try {
    // Validate and parse the request body using Zod schema
    const jobPostData = jobPostSchema.parse(req.body);

    // Create a new JobPost instance with parsed data
    const newJobPost = new JobPost({
      ...jobPostData,
      employer: req.user.id,
    });

    // Save the new job post to the database
    await newJobPost.save();

    // Respond with a success message
    res.status(200).json({ message: 'Job post created successfully', jobId: newJobPost.jobId });

    // Trigger matching logic in the background
    setImmediate(async () => {
      try {
        await matchResumesForJob(newJobPost.jobId); // Call the matching function
        console.log(`Matching process for jobId ${newJobPost.jobId} completed.`);
      } catch (err) {
        console.error(`Error during matching for jobId ${newJobPost.jobId}:`, err.message);
      }
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      console.log(err.errors);
      return res.status(400).json({ message: err.errors.map((e) => e.message) });
    }
    console.log(err.message);
    res.status(500).json({ message: 'Error posting job', error: err.message });
  }
});

router.get("/login/success", (req, res) => {
  if (req.user) {
    res.status(200).json({
      success: true,
      message: "successfull",
      user: req.user,
    });
  }
});

router.get("/login/failed", (req, res) => {
  res.status(401).json({
    success: false,
    message: "failure",
  });
});


router.get("/google-signup", passport.authenticate("google-signup-employer", { scope: ["profile", "email"] }));

router.get(
  "/google-signup/callback",
  (req, res, next) => {
    passport.authenticate("google-signup-employer", { session: false }, (err, user, info) => {
      if (err || !user) {
        return res.redirect(`${CLIENT_URL}signup-employer/?message=${encodeURIComponent(info.message)}`);
      }
      res.redirect(`${CLIENT_URL}?message=${encodeURIComponent(info.message)}`);
    })(req, res, next);
  }
);


router.get("/google-signin", passport.authenticate("google-signin-employer", { scope: ["profile", "email"] }));

router.get(
  "/google-signin/callback",
  (req, res, next) => {
    passport.authenticate("google-signin-employer", { session: false }, (err, user, info) => {
      if (err || !user) {
        return res.redirect(`${CLIENT_URL}signin-employer/?message=${encodeURIComponent(info.message)}`);
      }
      const payload = {
        id: user._id,
        email: user.email,
        fullName: user.fullName,
        role:"employer"
      };

      const token = jwt.sign(payload, process.env.JWT_SECRET);
      
      // Set the JWT token in an HTTP-only, secure cookie
      res.cookie('token', token, {
        httpOnly: true,   // Prevents client-side JavaScript from accessing the cookie
        secure: false,     // Ensures the cookie is sent only over HTTPS (set to false if testing locally over HTTP)
        sameSite: 'Strict'// CSRF protectio // 1 hour
      });
      res.redirect(`${CLIENT_URL}?message=${encodeURIComponent(info.message)}`);
    })(req, res, next);
  }
);




module.exports = router;