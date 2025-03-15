const mongoose = require('mongoose');
const cities = require('./cities');
const { places, descriptors } = require('./seedHelpers');
const Campground = require('../models/campgrounds');

mongoose.connect('mongodb://localhost:27017/CampHunt', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(() => {
    console.log("MongoDB connected successfully!");
}).catch(err => {
    console.error("MongoDB connection error:", err);
});

const sample = array => array[Math.floor(Math.random() * array.length)];
const seedDB = async () => {
    await Campground.deleteMany({});
    for (let i = 0; i < 400; i++) {
        const random1000 = Math.floor(Math.random() * 500);
        const camp = new Campground({
            author:'67d28f5e570eca58ca333109',
            location: `${cities[random1000].city}, ${cities[random1000].state}`,
            title: `${sample(descriptors)} ${sample(places)}`,
            description:'Escape into nature and experience the perfect outdoor adventure at our scenic and serene campgrounds!',
            price:`${Math.floor(Math.random()*2000)}`,
            geometry:{
              type:"Point",
              coordinates:[
                cities[random1000].longitude,
                cities[random1000].latitude
              ]
            },
            images: [
                {
                  url:'https://res.cloudinary.com/dpjpcwjip/image/upload/v1741599718/CampHunt/atcr2uleps5qxlvlk3wn.jpg',
                  filename: 'CampHunt/w6fwr6mksc3sd6dybzow',
                },
                {
                  url: 'https://res.cloudinary.com/dpjpcwjip/image/upload/v1741599715/CampHunt/iy2xf29jl4knvd48bnvd.jpg',
                  filename: 'CampHunt/iy2xf29jl4knvd48bnvd',
                },
                {
                  url: 'https://res.cloudinary.com/dpjpcwjip/image/upload/v1741599714/CampHunt/w6fwr6mksc3sd6dybzow.jpg',
                  filename: 'CampHunt/atcr2uleps5qxlvlk3wn',
                }
              ],
        });

        await camp.save();
    }

    console.log("Database Seeded Successfully!");
};

seedDB().then(() => {
    mongoose.connection.close();
    console.log("MongoDB connection closed.");
});
