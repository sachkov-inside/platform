FROM golang:1.27-alpine

WORKDIR /app

COPY . .

RUN go mod download
RUN go build -o /app/server .

EXPOSE 8080

CMD ["/app/server"]
