// Collected from Otel
'use strict';

const { diag, DiagConsoleLogger, DiagLogLevel } = require("@opentelemetry/api");
// diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

const my_meter = require('./create-a-meter');
const { emitsPayloadMetric, emitReturnTimeMetric } = require('./get-meter-emit-functions')(my_meter)

// NOTE: TracerProvider must be initialized before instrumented packages
// (i.e. 'aws-sdk' and 'http') are imported.
const my_tracer = require('./create-a-tracer');

const http = require('http');
const AWS = require('aws-sdk');

const api = require('@opentelemetry/api');

const shouldSampleAppLog = (process.env.SAMPLE_APP_LOG_LEVEL || "INFO") == "INFO"

require('dotenv').config()

// Load express
const express  = require("express");
const app = express()
const bodyParser = require("body-parser");
const axios = require("axios");

app.use(bodyParser.urlencoded({extended: true})); 
app.use(bodyParser.json()); 

// Load Mongoose
const mongoose = require("mongoose");

// Global User Object which will be the instance of MongoDB document
// "${process.env.mongoDbUrl}"
var User;
async function connectMongoose() {
	await mongoose.connect(process.env.MONGODB_URL, { useNewUrlParser: true, useUnifiedTopology:true }).then(() =>{
		console.log("mongoose connected..")
	})
	require("./User")
	User = mongoose.model("User")
}


// Load initial modules
async function initialLoad() {
	await connectMongoose();
}

initialLoad()
/**
 * IMPROVEMENT: Each API can sit in a different file if we want to scale the application to perform larger operations
 */

// Main endpoint
app.get("/", (req, res) => {
	const requestStartTime = new Date();
	res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId)
	res.send("This is our main endpoint")
	emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/', res.statusCode);
	emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
})

// GET all users
app.get("/users",async (req, res) => {
	const requestStartTime = new Date();
	User.find().then((users) => {
		res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId)
		res.send(users)
		emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/users', res.statusCode);
		emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
	}).catch((err) => {
		if(err) {
			throw err
		}
	})
})

// GET single user
app.get("/users/:uid",async (req, res) => {
	const requestStartTime = new Date();
	User.findById(req.params.uid).then((user) => {
		res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId)
		if(user){
			res.json(user)
			emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/users', res.statusCode);
			emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
		} else {
			res.sendStatus(404)
		}
	}).catch( err => {
		if(err) {
			throw err
		}
	})
})

// GET all orders for an user
app.get("/users/:uid/orders", async (req, res) => {
	const requestStartTime = new Date();
	res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId)
	axios.get(`/orders?uid=${req.params.uid}`).then( (orders) => {
		
		if(orders) {
			res.send(orders)
			emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/users', res.statusCode);
			emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
		}
	}).catch( err => {
		res.sendStatus(404).send(err)
	})
})

// Create new user
app.post("/user", async (req, res) => {
	const requestStartTime = new Date();
	const newUser = {
		"firstName":req.body.firstName,
		"lastName": req.body.lastName,
		"email":req.body.email,
		"phone": req.body.phone,
		"address": req.body.address,
		"orders": req.body.orders
	}
	
	// Create new User instance..
	const user = new User(newUser)
	user.save().then((r) => {
		res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId).status(201).send("User created..")
		// emitsPayloadMetric(res._contentLength + req.socket.bytesRead, '/user', res.statusCode);
		emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/user', res.statusCode);
        emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
		
	}).catch( (err) => {
		if(err) {
			throw err
		}
	})
	
})

// Create new order for a user
app.post("/users/:uid/order", async (req, res) => {
	const requestStartTime = new Date();
	res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId)
	try {
		const orderResponse = await axios.post(`${process.env.ORDERS_API_URL}/order`,{
			name:req.body.name,
			customerId: mongoose.Types.ObjectId(req.params.uid),
			amount:req.body.amount,
			image:req.body.image,
			createdAt:req.body.createdAt,
			qty:req.body.qty
		})
		
		if(orderResponse.status === 201) {
			User.findById(req.params.uid, (err, user) => {
				user.orders.push(orderResponse.data._id)
				user.save().then(() => {
					res.status(201)
					res.send(`Order created for user:${user.email} with orderId:${orderResponse.data._id}`)
					emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/users', res.statusCode);
					emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
				}).catch(e => {
					res.status(404)
					res.send("failed to add orderId in user's doc")
				})
			})	
		} else {
			res.send(500)
			res.send("Order not created..")
		}
	} catch (error) {
		res.sendStatus(400).send("Error while creating the order")
		
	}
})

// Delete user by userId
app.delete("/users/:uid", async (req, res) => {
	const requestStartTime = new Date();
	res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId)
	User.findByIdAndDelete(req.params.uid).then((delUser) => {
		if(delUser == null)
		res.send("User deleted with success...")
		emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/users', res.statusCode);
		emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
	}).catch( () => {
		res.sendStatus(404)
	})
})


// Delete all the orders for an user
app.delete("/users/:uid/orders", async (req, res) => {
	const requestStartTime = new Date();
	res.setHeader("traceId", JSON.parse(getTraceIdJson()).traceId)
	axios.delete(`${process.env.ORDERS_API_URL}/orders?uid=${req.params.uid}`).then( (delRes) => {
		res.status(202).send("Orders deleted..")
		emitsPayloadMetric(res._contentLength + mimicPayLoadSize(), '/users', res.statusCode);
		emitReturnTimeMetric(new Date() - requestStartTime, '/user', res.statusCode);
	}).catch( (err) => {
		res.status(404).send("Orders not found...")
	})
})

// APP listening on port 4040
app.listen(5050, () => {
	console.log("Up and running! -- This is our Users service")
})


function getTraceIdJson() {
	const otelTraceId = api.trace.getSpan(api.context.active()).spanContext().traceId;
	const timestamp = otelTraceId.substring(0, 8);
	const randomNumber = otelTraceId.substring(8);
	const xrayTraceId = "1-" + timestamp + "-" + randomNumber;
	return JSON.stringify({ "traceId": xrayTraceId });
  }
  
function mimicPayLoadSize() {
	return Math.random() * 1000;
}