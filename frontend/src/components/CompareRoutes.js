import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Clock, DollarSign, Activity, MapPin } from 'lucide-react';

export function CompareRoutes({ tripData }) {
  if (!tripData || !tripData.routes || tripData.routes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">No routes to compare</p>
      </div>
    );
  }

  const activityCounts = tripData.routes.map((route, idx) => {
    return tripData.activities?.filter(a => 
      !a.route_numbers || a.route_numbers.includes(idx + 1)
    ).length || 0;
  });

  const hotelCounts = tripData.routes.map((route, idx) => {
    return tripData.hotels?.filter(h => 
      !h.route_numbers || h.route_numbers.includes(idx + 1)
    ).length || 0;
  });

  return (
    <div className="p-6">
      <h2 className="text-2xl font-heading font-bold mb-6">Compare All Routes</h2>
      
      {/* Desktop: Table View */}
      <div className="hidden lg:block overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-border">
              <th className="text-left p-4 font-heading font-semibold">Feature</th>
              {tripData.routes.map((route, idx) => (
                <th key={idx} className="text-left p-4 font-heading font-semibold">
                  Route {idx + 1}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border">
              <td className="p-4 font-medium">Name</td>
              {tripData.routes.map((route, idx) => (
                <td key={idx} className="p-4">
                  <span className="text-sm">{route.name}</span>
                </td>
              ))}
            </tr>
            <tr className="border-b border-border bg-accent/30">
              <td className="p-4 font-medium">Distance</td>
              {tripData.routes.map((route, idx) => (
                <td key={idx} className="p-4">
                  <Badge variant="secondary">{route.distance}</Badge>
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <td className="p-4 font-medium flex items-center gap-2">
                <Clock className="h-4 w-4" /> Time
              </td>
              {tripData.routes.map((route, idx) => (
                <td key={idx} className="p-4">{route.estimated_time}</td>
              ))}
            </tr>
            <tr className="border-b border-border bg-accent/30">
              <td className="p-4 font-medium flex items-center gap-2">
                <Activity className="h-4 w-4" /> Activities
              </td>
              {activityCounts.map((count, idx) => (
                <td key={idx} className="p-4">
                  <span className="font-semibold text-primary">{count}</span> activities
                </td>
              ))}
            </tr>
            <tr className="border-b border-border">
              <td className="p-4 font-medium flex items-center gap-2">
                <MapPin className="h-4 w-4" /> Hotels
              </td>
              {hotelCounts.map((count, idx) => (
                <td key={idx} className="p-4">
                  <span className="font-semibold text-primary">{count}</span> options
                </td>
              ))}
            </tr>
            <tr className="border-b border-border bg-accent/30">
              <td className="p-4 font-medium">Type</td>
              {tripData.routes.map((route, idx) => (
                <td key={idx} className="p-4">
                  <span className="text-sm text-muted-foreground">{route.description?.substring(0, 60)}...</span>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Mobile: Card View */}
      <div className="lg:hidden space-y-4">
        {tripData.routes.map((route, idx) => (
          <Card key={idx}>
            <CardHeader>
              <CardTitle className="text-base">Route {idx + 1}: {route.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Distance:</span>
                <Badge variant="secondary">{route.distance}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time:</span>
                <span>{route.estimated_time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Activities:</span>
                <span className="font-semibold text-primary">{activityCounts[idx]}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Hotels:</span>
                <span className="font-semibold text-primary">{hotelCounts[idx]}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}