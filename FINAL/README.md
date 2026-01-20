# Bus Stops Web Application

Web application for viewing bus stops, bus routes and arrival times in Estonia.
The project was created as a course assignment.

The application consists of a frontend (HTML, JavaScript, Bootstrap), a backend (Node.js with Express) and a MySQL database using GTFS data.

The user can select a region and a bus stop with autocomplete, view available bus routes sorted correctly (including routes with letters such as 10A), and see upcoming bus arrival times. Arrival times are shown for the next 24 hours, including an indication when the arrival happens tomorrow. Additional arrival times can be displayed using the "Show more" button. The application also supports automatic geolocation and detection of the nearest bus stop.

## How to run the project

1. Open a terminal in the project directory
2. Install dependencies:
   ```bash
   npm install
   ```

# Database credentials

For security reasons, database credentials are not included in this repository.

In the file server.js, the following placeholder values are used:

```bash
user: "login",
password: "password"
```

To run the backend, these placeholders must be replaced with valid database credentials.


The database host and database name remain unchanged.
