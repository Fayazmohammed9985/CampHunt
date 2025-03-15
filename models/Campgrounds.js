const mongoose=require('mongoose')
const Review = require('./Review');
const { geolocation } = require('@maptiler/client');
const Schema=mongoose.Schema;

const ImageSchema=new Schema({
    url:String,
    filename:String
})
ImageSchema.virtual('thumbnail').get(function(){
    return this.url.replace('/upload','/upload/w-200')
})

const CampgroundSchema=new Schema({
    title:String,
    location:String,
    geometry: {
        type: {
          type: String, 
          enum: ['Point'], 
          required: true
        },
        coordinates: {
          type: [Number],
          required: true
        }
      },
    images:[ImageSchema],  
    price:Number,
    description:String,
    author:{
        type:Schema.Types.ObjectId,
        ref:'User'
    },
    reviews:[{
        type:Schema.Types.ObjectId,
        ref:'Review'
    }],

},{ toJSON: { virtuals: true }, toObject: { virtuals: true } })

CampgroundSchema.virtual('properties.popUpMarkup').get(function () {
    return `<strong><a href="/campgrounds/${this._id}">${this.title}</a></strong>`;
});





CampgroundSchema.post('findOneAndDelete',async function(doc) {
    if(doc){
        await Review.deleteMany({
            _id:{
                $in:doc.reviews
            }
        })
    }
})

module.exports=mongoose.model('Campground',CampgroundSchema)
