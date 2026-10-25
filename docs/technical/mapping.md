## MAPPING

To pass boundaries between layers, we need to map the data from one layer to another. This is done using mappers. Mappers are responsible for converting data from one format to another.

### Deep object mapping

In the domain layer, we have deep models, which are objects that contain other objects. When we map these objects to a different layer, we need to make sure that we are not losing any data. This is done by mapping the objects recursively.

But when it require data fetching from a data source, we stop and let 
