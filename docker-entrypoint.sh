#!/bin/bash

sed -i "s={PROJECT_SERVICE_URL}=$PROJECT_SERVICE_URL=g" src/server.js

npm start