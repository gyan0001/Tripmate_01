import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Trash2, Calendar, MapPin } from 'lucide-react';

export function SavedTrips({ trips, onLoad, onDelete }) {
  if (trips.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-center">
        <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-4">
          <MapPin className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-heading font-semibold mb-2">No Saved Trips Yet</h3>
        <p className="text-sm text-muted-foreground max-w-sm">
          Start planning a trip and save it to access later!
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-2xl font-heading font-bold mb-4">My Saved Trips</h2>
      <div className="grid gap-4">
        {trips.map((trip) => (
          <Card key={trip.id} className="hover:border-primary/50 transition-colors">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <CardTitle className="text-lg">
                    {trip.data.from} → {trip.data.to}
                  </CardTitle>
                  <CardDescription className="mt-1 flex items-center gap-4 text-xs">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {trip.data.duration}
                    </span>
                    <span>•</span>
                    <span>{new Date(trip.savedAt).toLocaleDateString()}</span>
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="ml-2">
                  {trip.data.routes?.length || 0} routes
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => onLoad(trip)}
                  className="flex-1"
                  size="sm"
                >
                  Load Trip
                </Button>
                <Button
                  onClick={() => onDelete(trip.id)}
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}